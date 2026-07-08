const multer = require('multer');
const path = require('path');
const fs = require('fs');

const tempDir = path.join(__dirname, '../../uploads/temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure standard extensions constraint
const allowedExtensions = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.txt', '.jpg', '.jpeg', '.png', '.zip', '.rar',
  '.mp4', '.mp3'
];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} not allowed. Supported formats: ${allowedExtensions.join(', ')}`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit per file
});

module.exports = upload;
