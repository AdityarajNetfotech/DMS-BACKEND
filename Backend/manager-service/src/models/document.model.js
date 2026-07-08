const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  originalFileName: {
    type: String,
    required: true,
  },
  fileType: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
  },
  extension: {
    type: String,
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  fileSize: {
    type: Number,
    required: true,
  },
  versionNumber: {
    type: Number,
    default: 1,
  },
  description: {
    type: String,
    trim: true,
  },
  tags: {
    type: [String],
    default: [],
  },
  storageUrl: {
    type: String,
    required: true,
  },
  thumbnailUrl: {
    type: String,
  },
  status: {
    type: String,
    enum: ['Active', 'Locked', 'Archived'],
    default: 'Active',
  },
  isLocked: {
    type: Boolean,
    default: false,
  },
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  downloadCount: {
    type: Number,
    default: 0,
  }
}, { timestamps: true });

documentSchema.index({ name: 1, folderId: 1, tenantId: 1 });

module.exports = documentSchema;
