const https = require('https');
const http = require('http');

let pdfLib = null;
try {
  pdfLib = require('pdf-lib');
} catch (e) {
  console.warn('pdf-lib is not available yet:', e.message);
}

/**
 * Helper to fetch remote image buffer (e.g. for tenant logo)
 */
const fetchImageBuffer = (url) => {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return resolve(null);
    }
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
};

/**
 * Apply dynamic watermark to a PDF buffer
 * @param {Buffer|Uint8Array} inputPdfBuffer 
 * @param {Object} metadata { companyName, logoUrl, userEmail, documentName, timestamp }
 * @returns {Promise<Buffer>}
 */
const applyWatermarkToPdf = async (inputPdfBuffer, metadata = {}) => {
  try {
    if (!inputPdfBuffer || inputPdfBuffer.length === 0) {
      return inputPdfBuffer;
    }

    if (!pdfLib) {
      try {
        pdfLib = require('pdf-lib');
      } catch (e) {
        console.warn('pdf-lib is not installed, skipping watermark');
        return inputPdfBuffer;
      }
    }

    const { PDFDocument, rgb, degrees, StandardFonts } = pdfLib;
    const pdfDoc = await PDFDocument.load(inputPdfBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return inputPdfBuffer;

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const companyName = (metadata.companyName || 'DMS Workspace').toUpperCase();
    const userEmail = metadata.userEmail || 'Confidential Access';
    const timestamp = metadata.timestamp || new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });

    // Attempt to load and embed tenant logo if provided
    let embeddedLogo = null;
    if (metadata.logoUrl) {
      try {
        const logoBuf = await fetchImageBuffer(metadata.logoUrl);
        if (logoBuf) {
          if (metadata.logoUrl.endsWith('.png') || metadata.logoUrl.includes('image/png')) {
            embeddedLogo = await pdfDoc.embedPng(logoBuf);
          } else {
            embeddedLogo = await pdfDoc.embedJpg(logoBuf);
          }
        }
      } catch (err) {
        // Fall back gracefully if logo embedding fails
      }
    }

    const watermarkDiagonalText = `${companyName} • CONFIDENTIAL`;
    const headerBannerText = `CONFIDENTIAL & PROPRIETARY | ${companyName} | ${timestamp} | ${userEmail}`;
    const footerBannerText = `PROTECTED DOCUMENT • PROPERTY OF ${companyName} • ALL RIGHTS RESERVED`;

    for (const page of pages) {
      const { width, height } = page.getSize();

      // 1. Top Security Banner Ribbon
      page.drawRectangle({
        x: 0,
        y: height - 24,
        width: width,
        height: 24,
        color: rgb(0.95, 0.96, 0.98),
        opacity: 0.92,
      });

      // Top line border
      page.drawLine({
        start: { x: 0, y: height - 24 },
        end: { x: width, y: height - 24 },
        thickness: 1,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.6,
      });

      // Top banner text
      page.drawText(headerBannerText, {
        x: 14,
        y: height - 16,
        size: 7.5,
        font: fontBold,
        color: rgb(0.7, 0.1, 0.1),
        opacity: 0.9,
      });

      // Optional Logo on top right of banner
      if (embeddedLogo) {
        try {
          const logoDim = embeddedLogo.scaleToFit(18, 18);
          page.drawImage(embeddedLogo, {
            x: width - logoDim.width - 12,
            y: height - 21,
            width: logoDim.width,
            height: logoDim.height,
            opacity: 0.9,
          });
        } catch (_) {}
      }

      // 2. Large Central Diagonal Watermark
      const diagonalFontSize = Math.max(26, Math.min(46, width / (watermarkDiagonalText.length * 0.5)));
      const textWidth = fontBold.widthOfTextAtSize(watermarkDiagonalText, diagonalFontSize);

      // Center calculation with 45 degree angle
      const rad45 = (45 * Math.PI) / 180;
      const cos45 = Math.cos(rad45);
      const sin45 = Math.sin(rad45);

      const centerX = width / 2;
      const centerY = height / 2;

      // Draw primary diagonal watermark in center
      page.drawText(watermarkDiagonalText, {
        x: centerX - (textWidth / 2) * cos45,
        y: centerY - (textWidth / 2) * sin45,
        size: diagonalFontSize,
        font: fontBold,
        color: rgb(0.75, 0.2, 0.2),
        opacity: 0.14,
        rotate: degrees(45),
      });

      // Draw secondary diagonal offset watermark for full-page coverage on larger documents
      if (height > 600) {
        page.drawText(`${userEmail} • ${timestamp}`, {
          x: centerX - (textWidth / 2) * cos45,
          y: centerY - (textWidth / 2) * sin45 - 32,
          size: 14,
          font: fontRegular,
          color: rgb(0.4, 0.4, 0.45),
          opacity: 0.12,
          rotate: degrees(45),
        });
      }

      // 3. Bottom Security Ribbon
      page.drawRectangle({
        x: 0,
        y: 0,
        width: width,
        height: 18,
        color: rgb(0.96, 0.97, 0.99),
        opacity: 0.9,
      });

      page.drawLine({
        start: { x: 0, y: 18 },
        end: { x: width, y: 18 },
        thickness: 0.8,
        color: rgb(0.8, 0.82, 0.86),
        opacity: 0.7,
      });

      page.drawText(footerBannerText, {
        x: width / 2 - (fontRegular.widthOfTextAtSize(footerBannerText, 6.5) / 2),
        y: 6,
        size: 6.5,
        font: fontRegular,
        color: rgb(0.35, 0.38, 0.45),
        opacity: 0.85,
      });
    }

    const modifiedPdfBytes = await pdfDoc.save();
    return Buffer.from(modifiedPdfBytes);
  } catch (err) {
    console.error('Failed to apply dynamic watermark to PDF:', err.message);
    // Fall back to original file without breaking the request
    return inputPdfBuffer;
  }
};

module.exports = {
  applyWatermarkToPdf,
  fetchImageBuffer
};
