const mongoose = require('mongoose');

const storageSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    unique: true,
  },
  totalStorageUsed: {
    type: Number,
    default: 0, // in bytes
  },
  maxStorageLimit: {
    type: Number,
    default: 5368709120, // 5 GB default
  }
}, { timestamps: true });

module.exports = storageSchema;
