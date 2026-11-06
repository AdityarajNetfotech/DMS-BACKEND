const http = require('http');
const https = require('https');

// Helper to verify credentials against VerifyChain when user logs in via SSO or cross-platform
const verifyWithVerifyChain = async (slug, email, password) => {
  const candidateUrls = [
    'http://172.17.0.1:5000',
    'http://172.17.0.1:4001',
    process.env.VC_GATEWAY_URL,
    process.env.VC_AUTH_SERVICE_URL,
    'http://103.192.198.240:5000',
    'http://verifychain-api-gateway:5000',
    'http://verifychain-auth-service:4001',
    'https://intellinexa.in',
    slug ? `https://${slug}.intellinexa.in` : null,
    'http://host.docker.internal:5000',
    'http://host.docker.internal:4001',
    'http://localhost:5000',
    'http://localhost:4001'
  ].filter(Boolean);

  const payload = JSON.stringify({ email, password });

  for (const base of candidateUrls) {
    try {
      const url = new URL(base.startsWith('http') ? base : `http://${base}`);
      const client = url.protocol === 'https:' ? https : http;
      const targetPort = url.port || (url.protocol === 'https:' ? 443 : 80);

      const res = await new Promise((resolve, reject) => {
        const req = client.request({
          protocol: url.protocol,
          hostname: url.hostname,
          port: targetPort,
          path: `/api/${slug}/auth/verify-password`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 2500
        }, (response) => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            try {
              resolve({ statusCode: response.statusCode, data: JSON.parse(body) });
            } catch (_) {
              resolve({ statusCode: response.statusCode, data: null });
            }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.write(payload);
        req.end();
      });

      if (res && res.statusCode === 200 && res.data && res.data.success) {
        return true;
      }
    } catch (_) {
      // Continue to next candidate URL
    }
  }

  return false;
};

const getArchivedItems = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const folderQuery = { tenantId, isArchived: true, isDeleted: false };
    const docQuery = { tenantId, isArchived: true, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      folderQuery.createdBy = req.user.userId;
      docQuery.uploadedBy = req.user.userId;
    }

    const folders = await req.Folder.find(folderQuery)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    const documents = await req.Document.find(docQuery)
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    res.status(200).json({
      success: true,
      message: 'Archived items retrieved successfully.',
      data: {
        folders,
        documents
      },
      errors: null
    });
  } catch (err) { next(err); }
};

const verifyArchivePassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    const userId = req.user.userId;

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const user = await req.User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let isMatch = false;
    try {
      isMatch = await user.comparePassword(password);
    } catch (_) {
      isMatch = false;
    }

    // If local password doesn't match, verify against VerifyChain login credentials
    if (!isMatch) {
      const slug = req.user.companySlug || req.params.companySlug || req.tenant?.companySlug;
      const isVcMatch = await verifyWithVerifyChain(slug, user.email, password);
      if (isVcMatch) {
        isMatch = true;
        // Synchronize password into DMS tenant database so subsequent checks are instant
        try {
          user.password = password;
          await user.save();
        } catch (saveErr) {
          console.warn('Could not sync user password into DMS:', saveErr.message);
        }
      }
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    res.status(200).json({
      success: true,
      message: 'Archive access verified successfully.',
      data: null,
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  getArchivedItems,
  verifyArchivePassword
};
