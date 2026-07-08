const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  tenantId: {
    type: String,
    required: true,
  }
}, { timestamps: true });

favoriteSchema.index({ userId: 1, documentId: 1, tenantId: 1 }, { unique: true });

module.exports = favoriteSchema;
