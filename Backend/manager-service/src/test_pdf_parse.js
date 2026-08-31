const pdfParse = require('pdf-parse');

// Minimal PDF structure as a buffer
const mockPdf = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
  '4 0 obj\n<< /Length 44 >>\nstream\n' +
  'BT\n/F1 12 Tf\n72 712 Td\n(Hello World) Tj\nET\n' +
  'endstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000216 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n310\n%%EOF\n'
);

pdfParse(mockPdf).then(result => {
  console.log('PDF Parse SUCCESS:', result.text);
}).catch(err => {
  console.error('PDF Parse ERROR:', err);
});
