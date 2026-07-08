const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const shareSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    default: null,
  },
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null,
  },
  sharedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  shareLink: {
    type: String,
    required: true,
    unique: true,
  },
  expiryDate: {
    type: Date,
    default: null,
  },
  password: {
    type: String,
    default: null,
  },
  isPasswordProtected: {
    type: Boolean,
    default: false,
  },
  sharingType: {
    type: String,
    enum: ['Internal', 'External'],
    default: 'External',
  },
  permissions: {
    readOnly: {
      type: Boolean,
      default: true,
    },
    download: {
      type: Boolean,
      default: true,
    }
  },
  sharedWithViewers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }]
}, { timestamps: true });

shareSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

shareSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return true;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = shareSchema;
