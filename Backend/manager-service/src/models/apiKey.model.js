const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    index: true,
  },
  systemName: {
    type: String,
    required: true, // e.g. 'LOS (Loan Origination System)', 'Core Banking (Finacle)', 'CRM'
    trim: true,
  },
  apiKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  apiSecret: {
    type: String,
    required: true,
  },
  permissions: {
    type: [String],
    default: ['document:ingest', 'document:read'],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastUsedAt: {
    type: Date,
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }
}, {
  timestamps: true
});

module.exports = apiKeySchema;
