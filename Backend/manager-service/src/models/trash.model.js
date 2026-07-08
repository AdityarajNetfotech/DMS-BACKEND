const mongoose = require('mongoose');

const trashSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
  },
  resourceType: {
    type: String,
    enum: ['Folder', 'Document'],
    required: true,
  },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  originalParentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  }
}, { timestamps: true });

trashSchema.index({ tenantId: 1, resourceType: 1, resourceId: 1 }, { unique: true });

module.exports = trashSchema;
