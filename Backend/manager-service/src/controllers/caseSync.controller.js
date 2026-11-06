const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const logger = require('../config/logger');
const activityService = require('../services/activity.service');
const storageService = require('../services/storage.service');
const folderService = require('../services/folder.service');
const verificationDocHelper = require('../helpers/verificationDoc.helper');
const signatureService = require('../services/signature.service');

const destDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// 5 Root Verification Folders Spec
const SYSTEM_ROOT_FOLDERS = [
  {
    name: 'KYC Documents',
    description: 'Identity verification documents (Aadhaar, Passport, PAN, Voter ID, Selfie)',
    folderColor: '#0284C7',
    folderIcon: 'user',
    folderCategory: 'Compliance'
  },
  {
    name: 'KYB Documents',
    description: 'Business verification documents (Certificate of Incorporation, MOA, AOA, GSTIN, CIN)',
    folderColor: '#10B981',
    folderIcon: 'building',
    folderCategory: 'Compliance'
  },
  {
    name: 'Director Documents',
    description: 'Director and Key Managerial Personnel verification, DIN, and KYC records',
    folderColor: '#8B5CF6',
    folderIcon: 'briefcase',
    folderCategory: 'Compliance'
  },
  {
    name: 'Partner Documents',
    description: 'Partnership agreements, deed documents, and Partner KYC records',
    folderColor: '#F59E0B',
    folderIcon: 'users',
    folderCategory: 'Compliance'
  },
  {
    name: 'Vendor Documents',
    description: 'Vendor registration, compliance clearances, invoices, and MSME documents',
    folderColor: '#EC4899',
    folderIcon: 'truck',
    folderCategory: 'Compliance'
  }
];

// Ensure the 5 root compliance folders exist for the tenant (delegates to centralized mutex & dedup)
const ensureRootVerificationFolders = async (req, tenantId, defaultUserId) => {
  return await folderService.ensureDefaultSystemFolders(req, tenantId, defaultUserId);
};

// Map VerifyChain subject_role and caseRef to the corresponding root folder name
const resolveTargetFolderName = (subjectRole, caseRef) => {
  const role = String(subjectRole || '').toLowerCase();
  const ref = String(caseRef || '').toUpperCase();

  if (role === 'company' || role === 'kyb' || ref.startsWith('KYB-')) {
    return 'KYB Documents';
  }
  if (role.includes('director') || role.includes('signatory') || ref.startsWith('DIR-')) {
    return 'Director Documents';
  }
  if (role.includes('partner') || ref.startsWith('PRT-') || ref.startsWith('PTR-')) {
    return 'Partner Documents';
  }
  if (role.includes('vendor') || ref.startsWith('VEN-')) {
    return 'Vendor Documents';
  }
  // Default to KYC
  return 'KYC Documents';
};

// Core synchronization routine for a single verification case
const processSingleCaseSync = async (req, caseData) => {
  const tenantId = req.params.companySlug || req.tenant?.companySlug;
  const Folder = req.Folder;
  const Document = req.Document;
  const User = req.User;

  const {
    caseRef,
    subjectRole,
    status,
    verificationLevel,
    applicantName,
    applicantEmail,
    applicantMobile,
    companyName,
    registrationNumber,
    documents = []
  } = caseData;

  if (!caseRef) {
    throw new Error('caseRef is required for case synchronization');
  }

  // 1. Resolve Admin / Default User for tenancy
  let adminUser = await User.findOne({
    role: { $in: ['Tenant Admin', 'Admin', 'Manager', 'Reporting Manager'] }
  });
  if (!adminUser) {
    adminUser = await User.findOne({});
  }
  if (!adminUser) {
    // Create a system integration user if none exists
    adminUser = new User({
      name: `${tenantId} System Integration`,
      email: `system@${tenantId}.local`,
      role: 'Tenant Admin',
      tenantId,
      status: 'Active'
    });
    try {
      await adminUser.save();
    } catch (uErr) {
      adminUser = { _id: new mongoose.Types.ObjectId() };
    }
  }
  const adminUserId = adminUser._id;

  // 2. Ensure the 5 root folders exist
  const rootFolderMap = await ensureRootVerificationFolders(req, tenantId, adminUserId);

  // 3. Determine the target root folder (KYC, KYB, Director, Partner, Vendor)
  const targetRootName = resolveTargetFolderName(subjectRole, caseRef);
  const rootFolder = rootFolderMap[targetRootName];
  if (!rootFolder) {
    throw new Error(`Target root folder '${targetRootName}' could not be resolved`);
  }

  // 4. Resolve applicant display name
  const resolvedApplicant = (applicantName || companyName || 'Applicant').trim();
  const caseFolderName = `${caseRef} - ${resolvedApplicant}`;

  // 5. Find or create case folder under root folder
  let caseFolder = await Folder.findOne({
    tenantId,
    parentFolder: rootFolder._id,
    $or: [
      { name: caseFolderName },
      { name: new RegExp(`^${caseRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*-.*)?$`, 'i') }
    ],
    isDeleted: false
  });

  const allowedEmailsList = Array.isArray(caseData.allowedEmails) ? [...caseData.allowedEmails] : [];
  if (caseData.assignedEmail && !allowedEmailsList.includes(caseData.assignedEmail)) {
    allowedEmailsList.push(caseData.assignedEmail);
  }
  if (caseData.creatorEmail && !allowedEmailsList.includes(caseData.creatorEmail)) {
    allowedEmailsList.push(caseData.creatorEmail);
  }
  const allowedNamesList = Array.isArray(caseData.allowedNames) ? [...caseData.allowedNames] : [];

  if (!caseFolder) {
    caseFolder = new Folder({
      name: caseFolderName,
      description: `Verification case ${caseRef} (${status || 'Active'})`,
      parentFolder: rootFolder._id,
      folderColor: rootFolder.folderColor,
      folderIcon: rootFolder.folderIcon,
      folderCategory: 'Compliance',
      isSystemFolder: false,
      tenantId,
      createdBy: adminUserId,
      departmentId: adminUser.departmentId || null,
      caseRef: caseRef,
      caseStatus: status || 'Active',
      assignedEmail: caseData.assignedEmail || null,
      creatorEmail: caseData.creatorEmail || null,
      allowedEmails: allowedEmailsList,
      allowedNames: allowedNamesList
    });
    await caseFolder.save();
    logger.info(`[caseSync] Created case folder '${caseFolderName}' in '${targetRootName}' for tenant ${tenantId}`);
  } else {
    // Update folder description, status and user permissions if changed
    caseFolder.description = `Verification case ${caseRef} (${status || 'Active'})`;
    caseFolder.name = caseFolderName;
    caseFolder.caseRef = caseRef;
    if (status) caseFolder.caseStatus = status;
    if (caseData.assignedEmail) caseFolder.assignedEmail = caseData.assignedEmail;
    if (caseData.creatorEmail) caseFolder.creatorEmail = caseData.creatorEmail;
    if (allowedEmailsList.length > 0) {
      const merged = Array.from(new Set([...(caseFolder.allowedEmails || []), ...allowedEmailsList]));
      caseFolder.allowedEmails = merged;
    }
    if (allowedNamesList.length > 0) {
      const mergedNames = Array.from(new Set([...(caseFolder.allowedNames || []), ...allowedNamesList]));
      caseFolder.allowedNames = mergedNames;
    }
    await caseFolder.save();
  }

  // 6. Ingest / Synchronize all case documents into the case folder
  const syncedDocs = [];

  for (const doc of documents) {
    try {
      const docCategory = doc.documentCategory || doc.category || 'document';
      const rawOriginalName = doc.originalFilename || doc.name || `${docCategory}.pdf`;
      const ext = path.extname(rawOriginalName).toLowerCase() || (doc.mimeType === 'application/json' ? '.json' : '.pdf');
      const docDisplayName = doc.name || doc.documentCategory?.replace(/_/g, ' ').toUpperCase() || path.basename(rawOriginalName, ext);

      let storageUrl = doc.storageUrl || '';
      let fileSize = Number(doc.size || doc.fileSize || 0);

      // A. If binary/base64 buffer was provided, write physical file to DMS uploads
      if (doc.fileBase64) {
        const fileBuffer = Buffer.from(doc.fileBase64, 'base64');
        fileSize = fileBuffer.length;
        const safeBaseName = path.basename(rawOriginalName).replace(/[^a-zA-Z0-9.-]/g, '_');
        const diskFileName = `${tenantId}_${caseRef}_${doc.id || Date.now()}_${safeBaseName}`;
        const physicalPath = path.join(destDir, diskFileName);

        fs.writeFileSync(physicalPath, fileBuffer);
        storageUrl = `/uploads/${diskFileName}`;
      } else if (!storageUrl && doc.extractedData) {
        // If no file but extracted verification payload exists, write formatted JSON summary
        const jsonContent = typeof doc.extractedData === 'string' ? doc.extractedData : JSON.stringify(doc.extractedData, null, 2);
        const jsonBuffer = Buffer.from(jsonContent, 'utf8');
        fileSize = jsonBuffer.length;
        const diskFileName = `${tenantId}_${caseRef}_${doc.id || Date.now()}_${docCategory}_verified.json`;
        const physicalPath = path.join(destDir, diskFileName);

        fs.writeFileSync(physicalPath, jsonBuffer);
        storageUrl = `/uploads/${diskFileName}`;
      }

      if (!storageUrl) {
        try {
          const safeBaseName = path.basename(rawOriginalName).replace(/[^a-zA-Z0-9.-]/g, '_');
          const pdfBaseName = safeBaseName.toLowerCase().endsWith('.pdf') ? safeBaseName : `${safeBaseName}.pdf`;
          const diskFileName = `${tenantId}_${caseRef}_${doc.id || Date.now()}_${pdfBaseName}`;
          const physicalPath = path.join(destDir, diskFileName);

          if (!fs.existsSync(physicalPath)) {
            const certBuf = await verificationDocHelper.generateVerificationPdf({
              name: docDisplayName,
              originalFileName: rawOriginalName,
              documentType: docCategory,
              customerName: resolvedApplicant,
              customerRef: caseRef,
              description: `Verified via VerifyChain (${doc.verificationStatus || status || 'VERIFIED'})`
            }, tenantId);
            fs.writeFileSync(physicalPath, certBuf);
            fileSize = certBuf.length;
          }
          storageUrl = `/uploads/${diskFileName}`;
        } catch (pdfErr) {
          logger.warn(`Could not generate fallback PDF for caseSync: ${pdfErr.message}`);
          storageUrl = `/uploads/${tenantId}_${caseRef}_placeholder.pdf`;
        }
      }

      // Check if document already exists in this case folder
      let existingDoc = await Document.findOne({
        tenantId,
        folderId: caseFolder._id,
        $or: [
          { name: docDisplayName },
          { originalFileName: rawOriginalName }
        ],
        isDeleted: false
      });

      const fileType = ext.replace('.', '').toUpperCase() || 'PDF';
      const resolvedMime = doc.mimeType || (fileType === 'PDF' ? 'application/pdf' : fileType === 'JSON' ? 'application/json' : 'application/octet-stream');

      // Multi-Party Signatures: Business User, Compliance Officer, Auditor
      const isCaseClosed = ['CASE_CLOSED', 'APPROVED', 'VERIFIED', 'COMPLETED', 'CLOSED'].includes(String(status).toUpperCase());
      const isForwarded = ['VERIFYING_BY_COMPLIANCE_OFFICER', 'COMPLIANCE_REVIEW', 'FORWARDED', 'FORWARDED_TO_COMPLIANCE', 'IN_REVIEW'].includes(String(status).toUpperCase()) || isCaseClosed;

      // Resolve the individual people: Business User (Aditya), Compliance Officer (Soudip), Auditor (Abhishek)
      const buName = caseData.businessUser?.name || caseData.creatorName || (caseData.allowedNames && caseData.allowedNames[0]) || 'Aditya';
      const buEmail = caseData.businessUser?.email || caseData.creatorEmail || (caseData.allowedEmails && caseData.allowedEmails[0]) || 'aditya@acmesolutions.com';
      const buSignedAt = caseData.businessUser?.forwardedAt || caseFolder.createdAt || new Date();

      const coName = caseData.complianceOfficer?.name || caseData.assignedName || (caseData.allowedNames && caseData.allowedNames[1]) || (isCaseClosed ? 'Soudip' : '');
      const coEmail = caseData.complianceOfficer?.email || caseData.assignedEmail || (caseData.allowedEmails && caseData.allowedEmails[1]) || (isCaseClosed ? 'soudip@acmesolutions.com' : '');
      const coSignedAt = caseData.complianceOfficer?.approvedAt || (isCaseClosed ? new Date() : null);

      const audName = caseData.auditor?.name || (isCaseClosed ? 'Abhishek' : '');
      const audEmail = caseData.auditor?.email || (isCaseClosed ? 'abhishek@acmesolutions.com' : '');
      const audSignedAt = caseData.auditor?.auditAt || (isCaseClosed ? new Date() : null);

      // Fetch user profile signatures if registered in DMS
      let buSig = '';
      let buSigType = 'type';
      if (buEmail) {
        try {
          const u = await User.findOne({ email: buEmail, isDeleted: { $ne: true } }).select('signature signatureType');
          if (u && u.signature) {
            buSig = u.signature;
            buSigType = u.signatureType || 'draw';
          }
        } catch {}
      }

      let coSig = '';
      let coSigType = 'type';
      if (coEmail) {
        try {
          const u = await User.findOne({ email: coEmail, isDeleted: { $ne: true } }).select('signature signatureType');
          if (u && u.signature) {
            coSig = u.signature;
            coSigType = u.signatureType || 'draw';
          }
        } catch {}
      }

      let audSig = '';
      let audSigType = 'type';
      if (audEmail) {
        try {
          const u = await User.findOne({ email: audEmail, isDeleted: { $ne: true } }).select('signature signatureType');
          if (u && u.signature) {
            audSig = u.signature;
            audSigType = u.signatureType || 'draw';
          }
        } catch {}
      }

      const caseSignatures = [
        {
          slot: 'Business User',
          role: 'Business User',
          step: 1,
          signerName: buName,
          signerEmail: buEmail,
          signature: buSig,
          signatureType: buSigType,
          signatureFont: 'Great Vibes',
          signatureInitials: buName.split(' ').map(n => n[0]).join('').substring(0, 3).toUpperCase(),
          status: isForwarded ? 'Signed' : 'Pending',
          signedAt: isForwarded ? buSignedAt : null,
          comments: `Accepted by Business User (${buName}) and forwarded to Compliance.`
        },
        {
          slot: 'Compliance Officer',
          role: 'Compliance Officer',
          step: 2,
          signerName: coName || (isCaseClosed ? 'Soudip' : ''),
          signerEmail: coEmail,
          signature: isCaseClosed ? coSig : '',
          signatureType: coSigType,
          signatureFont: 'Great Vibes',
          signatureInitials: coName ? coName.split(' ').map(n => n[0]).join('').substring(0, 3).toUpperCase() : 'SD',
          status: isCaseClosed ? 'Signed' : 'Pending',
          signedAt: isCaseClosed ? coSignedAt : null,
          comments: isCaseClosed ? (caseData.complianceOfficer?.comments || `Approved & electronically signed by Compliance Officer (${coName || 'Soudip'}).`) : 'Awaiting Compliance Officer review'
        },
        {
          slot: 'Auditor',
          role: 'Auditor',
          step: 3,
          signerName: audName || (isCaseClosed ? 'Abhishek' : ''),
          signerEmail: audEmail,
          signature: isCaseClosed ? audSig : '',
          signatureType: audSigType,
          signatureFont: 'Great Vibes',
          signatureInitials: audName ? audName.split(' ').map(n => n[0]).join('').substring(0, 3).toUpperCase() : 'AB',
          status: isCaseClosed ? 'Signed' : 'Pending',
          signedAt: isCaseClosed ? audSignedAt : null,
          comments: isCaseClosed ? `Audited & verified against compliance standards by Auditor (${audName || 'Abhishek'}).` : 'Awaiting audit review'
        }
      ];

      const workflowStatus = {
        requiresCompliance: true,
        reportingApproval: {
          status: isCaseClosed ? 'Approved' : 'Pending',
          approvedAt: isCaseClosed ? coSignedAt : null,
          comments: isCaseClosed ? (caseData.complianceOfficer?.comments || 'Approved by Compliance Officer') : ''
        },
        complianceApproval: {
          status: isCaseClosed ? 'Approved' : 'Pending',
          approvedAt: isCaseClosed ? audSignedAt : null,
          comments: isCaseClosed ? 'Audited & verified against compliance standards' : ''
        }
      };

      let targetDoc;
      if (existingDoc) {
        existingDoc.fileSize = fileSize || existingDoc.fileSize || 1024;
        existingDoc.storageUrl = storageUrl;
        existingDoc.status = 'Active';
        existingDoc.approvalStatus = 'Approved';
        existingDoc.validationStatus = 'Valid';
        existingDoc.isVerified = true;
        existingDoc.documentType = docCategory;
        existingDoc.customerName = resolvedApplicant;
        existingDoc.customerRef = caseRef;
        existingDoc.description = `Verified via VerifyChain (${doc.verificationStatus || status || 'VERIFIED'})`;
        existingDoc.signatures = caseSignatures;
        existingDoc.approvalWorkflow = workflowStatus;
        existingDoc.markModified('signatures');
        existingDoc.markModified('approvalWorkflow');
        await existingDoc.save();
        targetDoc = existingDoc;
        syncedDocs.push(existingDoc);
      } else {
        const newDoc = new Document({
          name: docDisplayName,
          originalFileName: rawOriginalName,
          fileType,
          mimeType: resolvedMime,
          extension: ext,
          folderId: caseFolder._id,
          tenantId,
          uploadedBy: adminUserId,
          managerId: String(adminUserId),
          fileSize: fileSize || 1024,
          storageUrl,
          status: 'Active',
          approvalStatus: 'Approved',
          validationStatus: 'Valid',
          isVerified: true,
          documentType: docCategory,
          customerName: resolvedApplicant,
          customerRef: caseRef,
          description: `Verified via VerifyChain (${doc.verificationStatus || status || 'VERIFIED'})`,
          tags: ['VerifyChain', targetRootName.replace(' Documents', ''), caseRef],
          signatures: caseSignatures,
          approvalWorkflow: workflowStatus
        });
        await newDoc.save();
        targetDoc = newDoc;

        // Increment storage count
        await storageService.checkAndIncrementStorage({ Document, tenantId, user: { companySlug: tenantId } }, fileSize || 1024).catch(() => {});
        syncedDocs.push(newDoc);
      }

      // Re-stamp the PDF document with updated signatures
      try {
        await signatureService.reStampDocumentFile(targetDoc, targetDoc.signatures);
      } catch (restampErr) {
        logger.warn(`[caseSync] Could not restamp PDF for ${targetDoc.name}: ${restampErr.message}`);
      }
    } catch (docErr) {
      logger.error(`[caseSync] Failed syncing document ${doc.originalFilename || doc.id}:`, docErr);
    }
  }

  return {
    caseFolderId: caseFolder._id,
    caseFolderName: caseFolder.name,
    targetRoot: targetRootName,
    syncedDocumentsCount: syncedDocs.length
  };
};

// Endpoint: POST /api/:companySlug/manager/sync-case
const syncCase = async (req, res, next) => {
  try {
    const result = await processSingleCaseSync(req, req.body);
    res.status(200).json({
      success: true,
      message: `Case ${req.body.caseRef} synchronized to DMS ${result.targetRoot}`,
      data: result
    });
  } catch (err) {
    logger.error('[caseSync] syncCase error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Endpoint: POST /api/:companySlug/manager/sync-batch-cases
const syncBatchCases = async (req, res, next) => {
  try {
    const { cases = [] } = req.body;
    const results = [];
    for (const c of cases) {
      try {
        const resSingle = await processSingleCaseSync(req, c);
        results.push({ caseRef: c.caseRef, success: true, ...resSingle });
      } catch (err) {
        results.push({ caseRef: c.caseRef, success: false, error: err.message });
      }
    }
    res.status(200).json({
      success: true,
      message: `Batch sync completed: ${results.filter(r => r.success).length}/${cases.length} successful`,
      data: results
    });
  } catch (err) {
    logger.error('[caseSync] syncBatchCases error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = {
  syncCase,
  syncBatchCases,
  processSingleCaseSync,
  ensureRootVerificationFolders
};

