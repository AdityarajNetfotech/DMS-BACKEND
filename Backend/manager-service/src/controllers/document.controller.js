const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const watermarkHelper = require('../helpers/watermark.helper');
const cloudinaryHelper = require('../helpers/cloudinary.helper');
const storageHelper = require('../helpers/storage.helper');
const documentService = require('../services/document.service');
const activityService = require('../services/activity.service');
const signatureService = require('../services/signature.service');
const { 
  updateDocumentSchema, 
  lockDocumentSchema, 
  archiveDocumentSchema, 
  favoriteDocumentSchema, 
  copyMoveDocumentSchema 
} = require('../validators/manager.validator');

const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { folderId, name, description, tags } = req.body;
    let parsedTags = [];
    if (tags) {
      parsedTags = Array.isArray(tags) ? tags : JSON.parse(tags);
    }

    const result = await documentService.uploadDocument(
      req,
      folderId,
      req.file,
      name,
      description,
      parsedTags
    );

    res.status(201).json({
      success: true,
      message: result.isNewVersion ? 'New version uploaded successfully.' : 'Document uploaded successfully.',
      data: result.document,
      errors: null
    });
  } catch (err) { next(err); }
};

const getDocumentDetails = async (req, res, next) => {
  try {
    const Document = req.Document;
    const Version = req.Version;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false })
      .populate('uploadedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('departmentId', 'name')
      .populate('folderId', 'name folderCategory isSystemFolder')
      .populate('approvalWorkflow.reportingApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.legalApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.complianceApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials');

    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Retrieve version history
    const versions = await Version.find({ documentId: doc._id }).sort({ versionNumber: -1 });

    res.status(200).json({
      success: true,
      message: 'Document details retrieved successfully.',
      data: {
        document: doc,
        versions
      },
      errors: null
    });
  } catch (err) { next(err); }
};

// Helper to stream remote files (Cloudinary, S3, etc.) directly to the client
// This eliminates Cloudinary PDF delivery restrictions and CORS errors in browser tabs
const streamRemoteFile = (url, res, fileName, mimeType, isDownload = false) => {
  return cloudinaryHelper.streamRemoteFile(url, res, fileName, mimeType, isDownload);
};

const fetchRemoteBuffer = (url) => {
  return cloudinaryHelper.fetchRemoteBuffer(url);
};

const checkIfConfidential = async (doc, req) => {
  if (doc.isConfidential) return true;
  if (doc.folderId) {
    const Folder = req.Folder;
    const folder = await Folder.findOne({ _id: doc.folderId, tenantId: req.user.companySlug, isDeleted: false });
    if (folder) {
      const folderNameLower = (folder.name || '').toLowerCase();
      if (
        folder.folderCategory === 'Legal' ||
        folder.folderCategory === 'Confidential' ||
        folderNameLower.includes('legal') ||
        folderNameLower.includes('confidential')
      ) {
        return true;
      }
    }
  }
  const nameLower = (doc.name || '').toLowerCase();
  return nameLower.includes('legal') || nameLower.includes('confidential');
};

/**
 * Resolves and dynamically stamps multi-party signatures on the last page,
 * applying watermark if confidential.
 */
const getStampedAndWatermarkedPdf = async (doc, req, isConfidential) => {
  try {
    // 1. Synchronize signatures across approval workflow & user profiles
    const currentSignatures = await signatureService.syncDocumentSignatures(doc, req);
    doc.signatures = currentSignatures;
    doc.markModified('signatures');
    doc.save().catch(e => console.warn('Non-blocking doc.save warning in preview/download:', e.message));

    // 2. Fetch raw buffer from disk or Cloudinary/remote
    let rawBuffer = null;
    if (doc.storageUrl && (doc.storageUrl.startsWith('/uploads') || doc.storageUrl.startsWith('uploads') || !doc.storageUrl.startsWith('http'))) {
      const fileName = path.basename(doc.storageUrl);
      const possiblePaths = [
        path.join(__dirname, '../../uploads', fileName),
        path.join(__dirname, '../../', doc.storageUrl.startsWith('/') ? doc.storageUrl.slice(1) : doc.storageUrl),
        path.join(process.cwd(), 'uploads', fileName)
      ];
      let foundPath = possiblePaths.find((p) => fs.existsSync(p));
      if (foundPath) {
        rawBuffer = fs.readFileSync(foundPath);
      }
    } else if (doc.storageUrl) {
      rawBuffer = await fetchRemoteBuffer(doc.storageUrl);
    }

    if (!rawBuffer) {
      return null;
    }

    // 3. Stamp multi-party execution certificate on the final page
    let finalBuffer = await signatureService.stampPdfLastPage(rawBuffer, currentSignatures, {
      name: doc.name,
      id: doc.fileHash ? doc.fileHash.substring(0, 10) : doc._id.toString().substring(0, 10),
      fileHash: doc.fileHash || '',
      isReStamp: true
    });

    if (!finalBuffer) finalBuffer = rawBuffer;

    // 4. Apply dynamic watermark if confidential
    if (isConfidential) {
      try {
        const companyName = req.tenant?.companyName || req.user?.companySlug || 'DMS Enterprise';
        const logoUrl = req.tenant?.logo || '';
        const userEmail = req.user?.email || 'Confidential User';

        const watermarkedBuffer = await watermarkHelper.applyWatermarkToPdf(finalBuffer, {
          companyName,
          logoUrl,
          userEmail,
          documentName: doc.name
        });
        if (watermarkedBuffer) finalBuffer = watermarkedBuffer;
      } catch (wmErr) {
        console.error('Dynamic watermarking error:', wmErr.message);
      }
    }

    return Buffer.isBuffer(finalBuffer) ? finalBuffer : Buffer.from(finalBuffer);
  } catch (err) {
    console.error('getStampedAndWatermarkedPdf failed:', err);
    return null;
  }
};

const downloadDocument = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId })
      .populate('uploadedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.reportingApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.legalApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.complianceApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials');

    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    if (doc.isLocked && req.user.role === 'Viewer') {
      return res.status(403).json({ success: false, message: 'Document is locked.' });
    }

    await activityService.logActivity(req, 'Document Downloaded', 'Document', doc._id);

    const docFileName = doc.originalFileName || `${doc.name}.${doc.extension || 'pdf'}`;
    const isConfidential = await checkIfConfidential(doc, req);
    const isPdf = (doc.mimeType === 'application/pdf') || (doc.extension && doc.extension.toLowerCase() === '.pdf') || docFileName.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const stampedBuffer = await getStampedAndWatermarkedPdf(doc, req, isConfidential);
      if (stampedBuffer) {
        const bufferToSend = Buffer.isBuffer(stampedBuffer) ? stampedBuffer : Buffer.from(stampedBuffer);
        const safeFileName = encodeURIComponent(docFileName);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`);
        res.setHeader('Content-Length', bufferToSend.length);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.end(bufferToSend);
      }
    }

    if (doc.storageUrl && doc.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', doc.storageUrl);
      if (fs.existsSync(filePath)) {
        return res.download(filePath, docFileName);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      // Stream remote Cloudinary/S3 file directly as download attachment
      return streamRemoteFile(
        doc.storageUrl,
        res,
        docFileName,
        doc.mimeType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
        true
      );
    }
  } catch (err) { next(err); }
};

const previewDocument = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false })
      .populate('uploadedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.reportingApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.legalApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.complianceApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials');

    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    await activityService.logActivity(req, 'Document Previewed', 'Document', doc._id);

    const docFileName = doc.originalFileName || `${doc.name}.${doc.extension || 'pdf'}`;
    const isConfidential = await checkIfConfidential(doc, req);
    const isPdf = (doc.mimeType === 'application/pdf') || (doc.extension && doc.extension.toLowerCase() === '.pdf') || docFileName.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const stampedBuffer = await getStampedAndWatermarkedPdf(doc, req, isConfidential);
      if (stampedBuffer) {
        const bufferToSend = Buffer.isBuffer(stampedBuffer) ? stampedBuffer : Buffer.from(stampedBuffer);
        const safeFileName = encodeURIComponent(docFileName);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`);
        res.setHeader('Content-Length', bufferToSend.length);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.end(bufferToSend);
      }
    }

    if (doc.storageUrl && (doc.storageUrl.startsWith('/uploads') || doc.storageUrl.startsWith('uploads') || !doc.storageUrl.startsWith('http'))) {
      const fileName = path.basename(doc.storageUrl);
      const possiblePaths = [
        path.join(__dirname, '../../uploads', fileName),
        path.join(__dirname, '../../', doc.storageUrl.startsWith('/') ? doc.storageUrl.slice(1) : doc.storageUrl),
        path.join(process.cwd(), 'uploads', fileName)
      ];
      let foundPath = possiblePaths.find((p) => fs.existsSync(p));

      if (foundPath) {
        let finalMimeType = doc.mimeType;
        if (!finalMimeType || finalMimeType === 'application/octet-stream') {
          const ext = path.extname(foundPath).toLowerCase();
          const mimeMap = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.csv': 'text/csv',
            '.json': 'application/json'
          };
          finalMimeType = mimeMap[ext] || 'application/octet-stream';
        }
        res.setHeader('Content-Type', finalMimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(docFileName)}"`);
        return res.sendFile(foundPath);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      // Stream remote Cloudinary file directly to browser
      return streamRemoteFile(
        doc.storageUrl,
        res,
        docFileName,
        doc.mimeType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
        false
      );
    }
  } catch (err) { next(err); }
};

const updateDocument = async (req, res, next) => {
  try {
    const { error, value } = updateDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const doc = await documentService.updateDocumentDetails(req, req.params.id, value);

    res.status(200).json({
      success: true,
      message: 'Document metadata updated successfully.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

const lockDocument = async (req, res, next) => {
  try {
    const { error, value } = lockDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const doc = await documentService.toggleLockDocument(req, req.params.id, value.isLocked);

    res.status(200).json({
      success: true,
      message: value.isLocked ? 'Document locked successfully.' : 'Document unlocked successfully.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

const archiveDocument = async (req, res, next) => {
  try {
    const { error, value } = archiveDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const doc = await documentService.toggleArchiveDocument(req, req.params.id, value.isArchived);

    res.status(200).json({
      success: true,
      message: value.isArchived ? 'Document archived successfully.' : 'Document restored from archive.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

const favoriteDocument = async (req, res, next) => {
  try {
    const { error, value } = favoriteDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const doc = await documentService.toggleFavoriteDocument(req, req.params.id, value.isFavorite);

    res.status(200).json({
      success: true,
      message: value.isFavorite ? 'Added to favorites.' : 'Removed from favorites.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

const softDeleteDocument = async (req, res, next) => {
  try {
    await documentService.softDeleteDocument(req, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Document soft-deleted successfully.',
      data: {},
      errors: null
    });
  } catch (err) { next(err); }
};

const copyDocument = async (req, res, next) => {
  try {
    const { error, value } = copyMoveDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const doc = await documentService.copyDocument(req, req.params.id, value.targetFolderId);

    res.status(200).json({
      success: true,
      message: 'Document copied successfully.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

const moveDocument = async (req, res, next) => {
  try {
    const { error, value } = copyMoveDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const doc = await documentService.moveDocument(req, req.params.id, value.targetFolderId);

    res.status(200).json({
      success: true,
      message: 'Document moved successfully.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

const getVersionHistory = async (req, res, next) => {
  try {
    const Version = req.Version;
    const tenantId = req.user.companySlug;

    const versions = await Version.find({ documentId: req.params.id, tenantId }).sort({ versionNumber: -1 });

    res.status(200).json({
      success: true,
      message: 'Version history retrieved successfully.',
      data: versions,
      errors: null
    });
  } catch (err) { next(err); }
};

const convertDocument = async (req, res, next) => {
  try {
    const { targetFormat } = req.body;
    if (!targetFormat) {
      return res.status(400).json({ success: false, message: 'Target format is required' });
    }
    const result = await documentService.convertDocument(req, req.params.id, targetFormat.toUpperCase());
    res.status(200).json({
      success: true,
      message: `Document converted to ${targetFormat} successfully.`,
      data: result,
      errors: null
    });
  } catch (err) { next(err); }
};

const restoreDocumentVersion = async (req, res, next) => {
  try {
    const { id, versionId } = req.params;
    const doc = await documentService.restoreVersion(req, id, versionId);
    res.status(200).json({
      success: true,
      message: 'Document version restored successfully.',
      data: doc,
      errors: null
    });
  } catch (err) { next(err); }
};

/**
 * POST /documents/:id/re-extract
 * Re-extracts and saves the text content of a single document.
 * Useful for documents uploaded before full-text extraction was enabled.
 */
const reExtractDocumentText = async (req, res, next) => {
  try {
    const result = await documentService.reExtractTextForDocument(req, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Text re-extracted successfully.',
      data: result,
      errors: null
    });
  } catch (err) { next(err); }
};

/**
 * POST /documents/backfill-text
 * Backfills extractedText for all documents that have empty text (up to 100 at a time).
 * Should be called by Tenant Admin to index existing documents for full-text search.
 */
const backfillExtractedText = async (req, res, next) => {
  try {
    const result = await documentService.backfillAllExtractedText(req);
    res.status(200).json({
      success: true,
      message: `Backfill complete. Processed: ${result.processed}, Failed: ${result.failed}, Total pending: ${result.total}`,
      data: result,
      errors: null
    });
  } catch (err) { next(err); }
};

const previewVersion = async (req, res, next) => {
  try {
    const Version = req.Version;
    const tenantId = req.user.companySlug;
    const { id, versionId } = req.params;

    const ver = await Version.findOne({ _id: versionId, documentId: id, tenantId });
    if (!ver) return res.status(404).json({ success: false, message: 'Version not found' });

    const fileName = ver.fileName || `document_v${ver.versionNumber}.pdf`;
    const isPdf = fileName.toLowerCase().endsWith('.pdf');

    if (ver.storageUrl.startsWith('/uploads') || ver.storageUrl.startsWith('uploads') || !ver.storageUrl.startsWith('http')) {
      const filePath = path.join(__dirname, '../../', ver.storageUrl.startsWith('/') ? ver.storageUrl.slice(1) : ver.storageUrl);
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
        return res.sendFile(filePath);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      return streamRemoteFile(
        ver.storageUrl,
        res,
        fileName,
        isPdf ? 'application/pdf' : 'application/octet-stream',
        false
      );
    }
  } catch (err) { next(err); }
};

const downloadVersion = async (req, res, next) => {
  try {
    const Version = req.Version;
    const tenantId = req.user.companySlug;
    const { id, versionId } = req.params;

    const ver = await Version.findOne({ _id: versionId, documentId: id, tenantId });
    if (!ver) return res.status(404).json({ success: false, message: 'Version not found' });

    const fileName = ver.fileName || `document_v${ver.versionNumber}.pdf`;
    const isPdf = fileName.toLowerCase().endsWith('.pdf');

    if (ver.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', ver.storageUrl);
      if (fs.existsSync(filePath)) {
        return res.download(filePath, fileName);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      return streamRemoteFile(
        ver.storageUrl,
        res,
        fileName,
        isPdf ? 'application/pdf' : 'application/octet-stream',
        true
      );
    }
  } catch (err) { next(err); }
};

const saveDocumentContent = async (req, res, next) => {
  try {
    const Document = req.Document;
    const Version = req.Version;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Strict Role check: Only Manager, Reporting Manager, and Admins can edit cloud document files
    const allowedRoles = ['Manager', 'Reporting Manager', 'Tenant Admin', 'Company Admin', 'Admin', 'Super Admin'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only Managers and Reporting Managers are permitted to edit document content in the cloud.'
      });
    }

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (doc.isLocked) {
      return res.status(403).json({ success: false, message: 'Document is locked and cannot be edited.' });
    }

    // Save CURRENT document state as a history Version before updating
    const versionHistory = new Version({
      tenantId,
      documentId: doc._id,
      versionNumber: doc.versionNumber,
      fileName: doc.originalFileName,
      fileSize: doc.fileSize,
      storageUrl: doc.storageUrl,
      uploadedBy: doc.uploadedBy,
      comment: req.body.comment || `Cloud Edited - Version ${doc.versionNumber}`
    });
    await versionHistory.save();

    let newFileSize = doc.fileSize;
    let newStorageUrl = doc.storageUrl;
    let newExtractedText = doc.extractedText || '';

    // Handle uploaded file if sent as multipart
    if (req.file) {
      const ext = path.extname(req.file.originalname);
      const geminiKey = req.headers?.['x-gemini-key'] || process.env.GEMINI_API_KEY;
      const openAiKey = req.headers?.['x-openai-key'] || process.env.OPENAI_API_KEY;

      // Extract text from new file
      try {
        const text = await documentService.extractTextFromFile(req.file.path, ext, geminiKey, openAiKey);
        if (text) newExtractedText = text;
      } catch (extractErr) {
        console.error('Failed to re-extract text on cloud edit:', extractErr.message);
      }

      // Upload new file to storage
      const uploadResult = await storageHelper.uploadToStorage(req.file);
      newStorageUrl = uploadResult.url;
      newFileSize = req.file.size;
    } else if (req.body.extractedText) {
      newExtractedText = req.body.extractedText;
    }

    // Update document record
    doc.versionNumber += 1;
    doc.fileSize = newFileSize;
    doc.storageUrl = newStorageUrl;
    doc.extractedText = newExtractedText;
    doc.uploadedBy = userId;
    if (req.body.name) doc.name = req.body.name.trim();
    if (req.body.customerName !== undefined) doc.customerName = req.body.customerName.trim();
    if (req.body.customerRef !== undefined) doc.customerRef = req.body.customerRef.trim();
    if (req.body.customerId !== undefined) doc.customerId = req.body.customerId.trim();
    if (req.body.accountNumber !== undefined) doc.accountNumber = req.body.accountNumber.trim();
    if (req.body.cifNumber !== undefined) doc.cifNumber = req.body.cifNumber.trim();
    if (req.body.facilityNumber !== undefined) doc.facilityNumber = req.body.facilityNumber.trim();
    if (req.body.facilityRef !== undefined) doc.facilityRef = req.body.facilityRef.trim();
    if (req.body.branch !== undefined) doc.branch = req.body.branch.trim();
    if (req.body.documentType !== undefined) doc.documentType = req.body.documentType.trim();
    if (req.body.description !== undefined) doc.description = req.body.description.trim();
    if (req.body.documentDate) doc.documentDate = new Date(req.body.documentDate);
    if (req.body.executionDate) doc.executionDate = new Date(req.body.executionDate);
    if (req.body.expiryDate) doc.expiryDate = new Date(req.body.expiryDate);

    await doc.save();

    await activityService.logActivity(req, 'Document Content Edited in Cloud', 'Document', doc._id);

    // Retrieve updated versions list
    const versions = await Version.find({ documentId: doc._id }).sort({ versionNumber: -1 });

    res.status(200).json({
      success: true,
      message: `Document updated to Version ${doc.versionNumber} successfully.`,
      data: {
        document: doc,
        versions
      },
      errors: null
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadDocument,
  getDocumentDetails,
  downloadDocument,
  previewDocument,
  previewVersion,
  downloadVersion,
  updateDocument,
  saveDocumentContent,
  lockDocument,
  archiveDocument,
  favoriteDocument,
  softDeleteDocument,
  copyDocument,
  moveDocument,
  getVersionHistory,
  convertDocument,
  restoreDocumentVersion,
  reExtractDocumentText,
  backfillExtractedText
};
