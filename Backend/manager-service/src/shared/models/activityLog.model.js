const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  tenantId: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    required: true,
  },
  resource: {
    type: String,
    enum: ['Folder', 'Document', 'Share', 'User', 'Auth', 'System'],
    required: true,
  },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
  },
  resourceName: {
    type: String,
    default: '',
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: {
    type: String,
  },
  browser: {
    type: String,
  },
  operatingSystem: {
    type: String,
  }
}, { timestamps: true });

module.exports = activityLogSchema;
