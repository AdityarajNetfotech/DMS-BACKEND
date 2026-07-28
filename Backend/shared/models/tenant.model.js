const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
  },
  legalBusinessName: {
    type: String,
    default: '',
  },
  companyCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  registrationNumber: {
    type: String,
    default: '',
  },
  registrationDate: {
    type: Date,
    default: Date.now,
  },
  gstNumber: {
    type: String,
    default: '',
  },
  panNumber: {
    type: String,
    default: '',
  },
  industryType: {
    type: String,
    default: '',
  },
  companySize: {
    type: String,
    default: '',
  },
  website: {
    type: String,
    default: '',
  },
  logo: {
    type: String,
    default: '',
  },
  primaryColor: {
    type: String,
    default: '#0B2C87',
  },
  fontFamily: {
    type: String,
    default: 'Inter',
  },
  description: {
    type: String,
    default: '',
  },
  officialEmail: {
    type: String,
    default: '',
  },
  companySlug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  adminEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  adminName: {
    type: String,
    default: '',
  },
  adminMobile: {
    type: String,
    default: '',
  },
  adminDesignation: {
    type: String,
    default: '',
  },
  phone: {
    type: String,
    default: '',
  },
  alternatePhone: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  addressLine2: {
    type: String,
    default: '',
  },
  city: {
    type: String,
    default: '',
  },
  state: {
    type: String,
    default: '',
  },
  postalCode: {
    type: String,
    default: '',
  },
  country: {
    type: String,
    default: '',
  },
  defaultLanguage: {
    type: String,
    default: 'English',
  },
  timezone: {
    type: String,
    default: 'IST (UTC+5:30)',
  },
  dbUri: {
    type: String,
    required: true,
    unique: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  trialEndsAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  },
  subscription: {
    plan: {
      type: String,
      enum: ['Trial', 'Basic', 'Pro', 'Ultra'],
      default: 'Trial'
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'past_due', 'cancelled'],
      default: 'active'
    },
    razorpayOrderId: {
      type: String,
      default: ''
    },
    razorpayPaymentId: {
      type: String,
      default: ''
    },
    expiresAt: {
      type: Date,
      default: null
    }
  },
  aiUsage: {
    count: {
      type: Number,
      default: 0
    },
    resetDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
