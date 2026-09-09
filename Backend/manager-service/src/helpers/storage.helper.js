const fs = require('fs');
const path = require('path');
const cloudinary = require('../config/cloudinary');
const logger = require('../config/logger');

const destDir = path.join(__dirname, '../../uploads');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const uploadToStorage = async (file) => {
  const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary';

  if (isCloudinary) {
    try {
      const originalName = file.originalname || file.name || path.basename(file.path || 'document');
      const ext = path.extname(originalName).toLowerCase();
      const baseName = path.basename(originalName, ext);
      const isPdf = ext === '.pdf' || file.mimetype === 'application/pdf';
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'].includes(ext);

      // Cloudinary configuration per file type
      const uploadOptions = {
        folder: 'dms_documents',
        use_filename: true,
        unique_filename: true,
        filename_override: originalName,
        access_mode: 'public'
      };

      if (isImage) {
        uploadOptions.resource_type = 'image';
      } else {
        // PDF, DOCX, XLSX, PPTX, CSV, ZIP, TXT, etc.
        uploadOptions.resource_type = 'raw';
      }

      const result = await cloudinary.uploader.upload(file.path, uploadOptions);

      // Delete temporary local file
      if (fs.existsSync(file.path)) {
        fs.unlink(file.path, (err) => {
          if (err) logger.error('Failed to delete temp file:', err);
        });
      }

      return {
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type || (isImage ? 'image' : 'raw')
      };
    } catch (error) {
      logger.error('Cloudinary Upload Error:', error);
      throw new Error(`Failed to upload file to Cloudinary: ${error.message}`);
    }
  } else {
    // Local storage
    try {
      const fileName = path.basename(file.path);
      const targetPath = path.join(destDir, fileName);
      
      // Move from temp to public upload directory
      fs.renameSync(file.path, targetPath);
      
      // Relative path so it can be served dynamically or proxy-addressed
      const relativeUrl = `/uploads/${fileName}`;
      return {
        url: relativeUrl,
        publicId: fileName
      };
    } catch (error) {
      logger.error('Local File Move Error:', error);
      throw new Error('Failed to save file locally');
    }
  }
};

const deleteFromStorage = async (url) => {
  const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary';

  if (isCloudinary) {
    try {
      // Cloudinary URL format:
      // https://res.cloudinary.com/<cloud_name>/<resource_type>/upload/v12345/dms_documents/filename.ext
      const parts = url.split('/');
      const uploadIdx = parts.indexOf('upload');
      
      let resourceType = 'image';
      if (uploadIdx > 0 && ['image', 'raw', 'video'].includes(parts[uploadIdx - 1])) {
        resourceType = parts[uploadIdx - 1];
      }

      // Extract public ID (everything after /upload/v12345/ or /upload/)
      let publicIdWithExt = parts.slice(uploadIdx + 1).join('/');
      // Remove version prefix (e.g. v1709482910/)
      publicIdWithExt = publicIdWithExt.replace(/^v\d+\//, '');

      // For images/PDFs uploaded as image, public_id is without extension
      // For raw files, public_id includes the extension
      const publicId = resourceType === 'raw' ? publicIdWithExt : publicIdWithExt.replace(/\.[^/.]+$/, '');

      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      logger.info(`Deleted file from Cloudinary: ${publicId} (type: ${resourceType})`);
    } catch (error) {
      logger.error('Cloudinary Deletion Error:', error);
    }
  } else {
    try {
      const fileName = path.basename(url);
      const filePath = path.join(destDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted file locally: ${fileName}`);
      }
    } catch (error) {
      logger.error('Local File Deletion Error:', error);
    }
  }
};

const uploadBufferToStorage = async (buffer, originalName = 'document.pdf', mimeType = 'application/pdf') => {
  const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary';

  if (isCloudinary) {
    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder: 'dms_documents',
        use_filename: true,
        unique_filename: true,
        filename_override: originalName,
        access_mode: 'public',
        resource_type: 'raw'
      };

      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) {
          logger.error('Cloudinary Buffer Upload Error:', error);
          return reject(error);
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type || 'raw'
        });
      });

      const { Readable } = require('stream');
      const stream = new Readable();
      stream.push(buffer);
      stream.push(null);
      stream.pipe(uploadStream);
    });
  } else {
    // Local storage
    try {
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(originalName) || '.pdf'}`;
      const targetPath = path.join(destDir, fileName);
      fs.writeFileSync(targetPath, buffer);
      return {
        url: `/uploads/${fileName}`,
        publicId: fileName
      };
    } catch (error) {
      logger.error('Local Buffer Save Error:', error);
      throw new Error('Failed to save buffer locally');
    }
  }
};

module.exports = {
  uploadToStorage,
  uploadBufferToStorage,
  deleteFromStorage
};

