const crypto = require('crypto');
const https = require('https');
const http = require('http');

/**
 * Parses a Cloudinary URL into its constituent parts
 */
function parseCloudinaryUrl(url) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return null;
  }
  const parts = url.split('/');
  const uploadIdx = parts.indexOf('upload');
  if (uploadIdx === -1) return null;

  const cloudName = parts[uploadIdx - 2] || process.env.CLOUDINARY_CLOUD_NAME || 'db6u4782y';
  const resourceType = parts[uploadIdx - 1] || 'raw';

  let publicIdWithExt = parts.slice(uploadIdx + 1).join('/');
  // Strip any transformation prefix or version prefix (e.g. fl_attachment/ or v1788760880/)
  publicIdWithExt = publicIdWithExt.replace(/^.*?(v\d+\/)/, '$1').replace(/^v\d+\//, '');

  const extMatch = publicIdWithExt.match(/\.([a-zA-Z0-9]+)$/);
  const format = extMatch ? extMatch[1] : '';
  const publicIdWithoutExt = publicIdWithExt.replace(/\.[^/.]+$/, '');

  return {
    cloudName,
    resourceType,
    publicIdWithExt,
    publicIdWithoutExt,
    format
  };
}

/**
 * Generates an authenticated download URL using Cloudinary private download signature
 * Completely bypasses Cloudinary 401 ACL/delivery restrictions for PDFs and raw files
 */
function getCloudinaryDownloadUrl(storageUrl, isDownload = false) {
  if (!storageUrl || typeof storageUrl !== 'string') return storageUrl;
  if (!storageUrl.includes('res.cloudinary.com')) return storageUrl;

  const parsed = parseCloudinaryUrl(storageUrl);
  if (!parsed) return storageUrl;

  const cloudName = parsed.cloudName || process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return storageUrl;
  }

  const publicId = parsed.resourceType === 'raw' ? parsed.publicIdWithExt : parsed.publicIdWithoutExt;
  const format = parsed.format || (parsed.resourceType === 'raw' ? '' : 'pdf');

  const timestamp = Math.floor(Date.now() / 1000);
  const type = 'upload';
  const attachment = isDownload ? 'true' : 'false';

  const params = {
    attachment,
    format: format || undefined,
    public_id: publicId,
    timestamp,
    type
  };

  const cleanParams = {};
  Object.keys(params).sort().forEach((k) => {
    if (params[k] !== undefined && params[k] !== '') {
      cleanParams[k] = params[k];
    }
  });

  const toSign = Object.keys(cleanParams)
    .map((k) => `${k}=${cleanParams[k]}`)
    .join('&');

  const signature = crypto
    .createHash('sha1')
    .update(toSign + apiSecret)
    .digest('hex');

  const queryParams = new URLSearchParams(cleanParams);
  queryParams.set('api_key', apiKey);
  queryParams.set('signature', signature);

  return `https://api.cloudinary.com/v1_1/${cloudName}/${parsed.resourceType}/download?${queryParams.toString()}`;
}

/**
 * Downloads a remote URL (local or Cloudinary) into a Buffer
 */
function fetchRemoteBuffer(url) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return resolve(null);
    }
    const finalUrl = getCloudinaryDownloadUrl(url, false);

    const makeRequest = (targetUrl, redirectCount = 0) => {
      if (redirectCount > 5) return resolve(null);
      const reqClient = targetUrl.startsWith('https') ? https : http;

      reqClient
        .get(targetUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return makeRequest(res.headers.location, redirectCount + 1);
          }
          if (res.statusCode !== 200) {
            console.warn(`fetchRemoteBuffer received HTTP status ${res.statusCode} for ${targetUrl}`);
            return resolve(null);
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', (err) => {
            console.error('fetchRemoteBuffer read error:', err.message);
            resolve(null);
          });
        })
        .on('error', (err) => {
          console.error('fetchRemoteBuffer request error:', err.message);
          resolve(null);
        });
    };

    makeRequest(finalUrl);
  });
}

/**
 * Streams a remote file (Cloudinary, S3, etc.) directly to the client response with correct MIME headers
 */
function streamRemoteFile(url, res, fileName, mimeType, isDownload = false) {
  const finalUrl = getCloudinaryDownloadUrl(url, isDownload);

  const makeStreamRequest = (targetUrl, redirectCount = 0) => {
    if (redirectCount > 5) {
      if (!res.headersSent) res.status(502).json({ success: false, message: 'Too many redirects fetching document' });
      return;
    }

    const client = targetUrl.startsWith('https') ? https : http;
    client
      .get(targetUrl, (remoteRes) => {
        if (remoteRes.statusCode >= 300 && remoteRes.statusCode < 400 && remoteRes.headers.location) {
          return makeStreamRequest(remoteRes.headers.location, redirectCount + 1);
        }

        if (remoteRes.statusCode !== 200) {
          console.warn(`Remote storage returned status ${remoteRes.statusCode} for URL ${targetUrl}`);
          if (!res.headersSent) {
            return res.status(remoteRes.statusCode || 502).json({
              success: false,
              message: `Remote storage error (HTTP ${remoteRes.statusCode})`
            });
          }
          return;
        }

        let contentType = mimeType || remoteRes.headers['content-type'];
        if (!contentType || contentType === 'application/octet-stream') {
          if (fileName && fileName.toLowerCase().endsWith('.pdf')) {
            contentType = 'application/pdf';
          } else {
            contentType = 'application/octet-stream';
          }
        }

        const disposition = isDownload ? 'attachment' : 'inline';
        const safeFileName = encodeURIComponent(fileName || 'document.pdf');

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader(
          'Content-Disposition',
          `${disposition}; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`
        );

        if (remoteRes.headers['content-length']) {
          res.setHeader('Content-Length', remoteRes.headers['content-length']);
        }

        remoteRes.pipe(res);
      })
      .on('error', (err) => {
        console.error('Remote file stream error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ success: false, message: 'Failed to stream document from remote storage' });
        }
      });
  };

  makeStreamRequest(finalUrl);
}

module.exports = {
  parseCloudinaryUrl,
  getCloudinaryDownloadUrl,
  fetchRemoteBuffer,
  streamRemoteFile
};
