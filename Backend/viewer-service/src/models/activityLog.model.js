const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  managerId: {
    type: String,
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
    required: true, // Folder, Document, Share etc.
  },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  ipAddress: {
    type: String,
    default: '',
  },
  browser: {
    type: String,
    default: '',
  },
  operatingSystem: {
    type: String,
    default: '',
  }
}, { timestamps: true });

module.exports = activityLogSchema;
