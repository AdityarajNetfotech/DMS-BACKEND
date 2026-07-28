const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  versionNumber: {
    type: Number,
    required: true,
  },
  fileName: {
    type: String,
    required: true,
  },
  fileSize: {
    type: Number,
    required: true,
  },
  storageUrl: {
    type: String,
    required: true,
  },
  uploadedBy: {
    type: String,
    required: true,
  },
  comment: {
    type: String,
    default: '',
  }
}, { timestamps: true });

versionSchema.index({ documentId: 1, versionNumber: 1, tenantId: 1 }, { unique: true });

module.exports = versionSchema;
