const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  tenantId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  type: {
    type: String,
    enum: ['StorageWarning', 'FolderActivity', 'DocumentActivity', 'ShareActivity'],
    required: true,
  }
}, { timestamps: true });

module.exports = notificationSchema;
