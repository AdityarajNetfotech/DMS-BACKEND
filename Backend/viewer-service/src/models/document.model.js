const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  originalFileName: {
    type: String,
    required: true,
  },
  fileType: {
    type: String, // PDF, XLSX, DOCX, etc.
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  extension: {
    type: String,
    required: true,
  },
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  tenantId: {
    type: String,
    required: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  managerId: {
    type: String,
    required: true,
  },
  fileSize: {
    type: Number, // in bytes
    required: true,
  },
  storageUrl: {
    type: String, // local path or Cloudinary URL
    required: true,
  },
  versionNumber: {
    type: Number,
    default: 1,
  },
  isLocked: {
    type: Boolean,
    default: false,
  },
  lockedBy: {
    type: String,
    default: null,
  },
  isArchived: {
    type: Boolean,
    default: false,
  },
  archivedAt: {
    type: Date,
    default: null,
  },
  downloadCount: {
    type: Number,
    default: 0,
  },
  tags: [String],
  description: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['Active', 'Archived', 'Locked'],
    default: 'Active',
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  }
}, { timestamps: true });

// Check duplicate documents within the same folder per tenant
documentSchema.index({ name: 1, folderId: 1, tenantId: 1 }, { unique: true });

module.exports = documentSchema;
