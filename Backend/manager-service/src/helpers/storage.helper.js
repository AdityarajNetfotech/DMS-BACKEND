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
      const result = await cloudinary.uploader.upload(file.path, {
        resource_type: 'auto',
        folder: 'dms_documents'
      });
      // Delete temporary local file
      fs.unlink(file.path, (err) => {
        if (err) logger.error('Failed to delete temp file:', err);
      });
      return {
        url: result.secure_url,
        publicId: result.public_id
      };
    } catch (error) {
      logger.error('Cloudinary Upload Error:', error);
      throw new Error('Failed to upload file to Cloudinary');
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
      // Extract public ID from Cloudinary URL
      // Format: https://res.cloudinary.com/.../v12345/dms_documents/filename.ext
      const parts = url.split('/');
      const publicIdWithExt = parts.slice(-2).join('/'); // dms_documents/filename.ext
      const publicId = publicIdWithExt.split('.')[0]; // dms_documents/filename

      await cloudinary.uploader.destroy(publicId);
      logger.info(`Deleted file from Cloudinary: ${publicId}`);
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

module.exports = {
  uploadToStorage,
  deleteFromStorage
};
