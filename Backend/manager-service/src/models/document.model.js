const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  originalFileName: {
    type: String,
    required: true,
  },
  fileType: {
    type: String, // PDF, XLSX, DOCX, etc.
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  extension: {
    type: String,
    required: true,
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
    type: String,
    required: true,
  },
  fileSize: {
    type: Number, // in bytes
    required: true,
  },
  storageUrl: {
    type: String, // local path or Cloudinary URL
    required: true,
  },
  versionNumber: {
    type: Number,
    default: 1,
  },
  isLocked: {
    type: Boolean,
    default: false,
  },
  lockedBy: {
    type: String,
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
  downloadCount: {
    type: Number,
    default: 0,
  },
  tags: [String],
  description: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['Active', 'Archived', 'Locked'],
    default: 'Active',
  },
  isConfidential: {
    type: Boolean,
    default: false,
  },
  watermarkText: {
    type: String,
    default: '',
  },
  // --- Banking Metadata Fields ---
  documentType: {
    type: String,
    default: '',
    trim: true,
  },
  customerId: {
    type: String,
    default: '',
    trim: true,
  },
  customerName: {
    type: String,
    default: '',
    trim: true,
  },
  customerRef: {
    type: String,
    default: '',
    trim: true,
  },
  facilityNumber: {
    type: String,
    default: '',
    trim: true,
  },
  facilityRef: {
    type: String,
    default: '',
    trim: true,
  },
  branch: {
    type: String,
    default: '',
    trim: true,
  },
  branchCode: {
    type: String,
    default: '',
    trim: true,
  },
  documentDate: {
    type: Date,
    default: null,
  },
  executionDate: {
    type: Date,
    default: null,
  },
  expiryDate: {
    type: Date,
    default: null,
  },
  requestingDate: {
    type: Date,
    default: null,
  },
  accountNumber: {
    type: String,
    default: '',
    trim: true,
  },
  cifNumber: {
    type: String,
    default: '',
    trim: true,
  },
  ifscCode: {
    type: String,
    default: '',
    trim: true,
  },
  accountType: {
    type: String,
    default: '',
    trim: true,
  },
  signatory: {
    type: String,
    default: '',
    trim: true,
  },
  partner: {
    type: String,
    default: '',
    trim: true,
  },
  typeOfService: {
    type: String,
    default: '',
    trim: true,
  },
  otherBankingMetadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  // --- Mandatory Field Validation ---
  validationStatus: {
    type: String,
    enum: ['Valid', 'Incomplete', 'Pending', ''],
    default: 'Pending',
  },
  missingMandatoryFields: {
    type: [String],
    default: [],
  },
  // --- AI Classification & Extraction ---
  aiClassification: {
    type: String,
    default: '',
  },
  aiConfidence: {
    type: String,
    enum: ['High', 'Medium', 'Low', ''],
    default: '',
  },
  aiExtractedMetadata: {
    type: Map,
    of: String,
    default: {},
  },
  aiProcessedAt: {
    type: Date,
    default: null,
  },
  // --- Security & Ingestion Tracking ---
  fileHash: {
    type: String,
    default: '',
    index: true,
  },
  isMalwareScanned: {
    type: Boolean,
    default: false,
  },
  scanResult: {
    type: String,
    enum: ['Clean', 'Infected', 'Skipped', ''],
    default: 'Clean',
  },
  ingestionSource: {
    type: String,
    default: 'Web UI',
  },
  // --- Approval Workflow Engine ---
  approvalStatus: {
    type: String,
    enum: [
      'Pending_Reporting_Approval',
      'Pending_Legal_Approval',
      'Pending_Compliance_Approval',
      'Pending_Dual_Approval',
      'Approved',
      'Rejected'
    ],
    default: 'Pending_Reporting_Approval',
    index: true,
  },
  approvalWorkflow: {
    requiresLegal: { type: Boolean, default: false },
    requiresCompliance: { type: Boolean, default: false },
    requiresReporting: { type: Boolean, default: true },
    legalApproval: {
      status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Not_Required'], default: 'Not_Required' },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      approvedAt: { type: Date, default: null },
      comments: { type: String, default: '' }
    },
    complianceApproval: {
      status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Not_Required'], default: 'Not_Required' },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      approvedAt: { type: Date, default: null },
      comments: { type: String, default: '' }
    },
    reportingApproval: {
      status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Not_Required'], default: 'Pending' },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      approvedAt: { type: Date, default: null },
      comments: { type: String, default: '' }
    }
  },
  signatures: [
    {
      slot: { type: String, required: true }, // 'Manager (Uploader)', 'Reporting Manager', 'Legal Manager', 'Compliance Manager'
      role: { type: String, required: true },
      step: { type: Number, default: 1 },
      signerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      signerName: { type: String, default: '' },
      signerEmail: { type: String, default: '' },
      signature: { type: String, default: '' },
      signatureType: { type: String, default: '' },
      signatureFont: { type: String, default: 'Great Vibes' },
      signatureInitials: { type: String, default: '' },
      signedAt: { type: Date, default: null },
      status: { type: String, enum: ['Signed', 'Pending', 'Rejected'], default: 'Pending' },
      comments: { type: String, default: '' }
    }
  ],
  rejectionReason: {
    type: String,
    default: '',
  },
  extractedText: {
    type: String,
    default: '',
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

// Check duplicate documents within the same folder per tenant
documentSchema.index({ name: 1, folderId: 1, tenantId: 1 }, { unique: true });

module.exports = documentSchema;
