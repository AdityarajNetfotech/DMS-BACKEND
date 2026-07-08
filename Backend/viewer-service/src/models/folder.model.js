const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  parentFolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null,
  },
  folderColor: {
    type: String,
    default: '#4A90E2', // Hex format
  },
  folderIcon: {
    type: String,
    default: 'folder', // FontAwesome class key
  },
  tenantId: {
    type: String,
    required: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  totalChildFolders: {
    type: Number,
    default: 0,
  },
  totalDocuments: {
    type: Number,
    default: 0,
  },
  isLocked: {
    type: Boolean,
    default: false,
  },
  isFavorited: {
    type: Boolean,
    default: false,
  },
  isArchived: {
    type: Boolean,
    default: false,
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

// Avoid duplicate folder names under the same parent folder per tenant
folderSchema.index({ name: 1, parentFolder: 1, tenantId: 1 }, { unique: true });

module.exports = folderSchema;
