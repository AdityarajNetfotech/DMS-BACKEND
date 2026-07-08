const cloudinary = require('cloudinary').v2;
const logger = require('./logger');

if (process.env.STORAGE_TYPE === 'cloudinary') {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  logger.info('Cloudinary storage configuration loaded.');
} else {
  logger.info('Using local disk storage configuration.');
}

module.exports = cloudinary;
