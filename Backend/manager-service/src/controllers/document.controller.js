const path = require('path');
const fs = require('fs');
const https = require('https');
const documentService = require('../services/document.service');
const activityService = require('../services/activity.service');
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

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false });
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

const downloadDocument = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Increment download count
    doc.downloadCount += 1;
    await doc.save();

    await activityService.logActivity(req, 'Document Downloaded', 'Document', doc._id);

    if (doc.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', doc.storageUrl);
      if (fs.existsSync(filePath)) {
        return res.download(filePath, doc.originalFileName);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      // For Cloudinary/remote URLs: insert fl_attachment to force download via browser redirect
      let downloadUrl = doc.storageUrl;
      if (downloadUrl.includes('/upload/')) {
        downloadUrl = downloadUrl.replace('/upload/', '/upload/fl_attachment/');
      }
      return res.redirect(downloadUrl);
    }
  } catch (err) { next(err); }
};

const previewDocument = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    await activityService.logActivity(req, 'Document Previewed', 'Document', doc._id);

    if (doc.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', doc.storageUrl);
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        return res.sendFile(filePath);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      // Remote redirection for direct viewing/embedding
      return res.redirect(doc.storageUrl);
    }
  } catch (err) { next(err); }
};

const updateDocument = async (req, res, next) => {
  try {
    const { error, value } = updateDocumentSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const { name, description, tags } = value;
    const doc = await documentService.updateDocumentDetails(req, req.params.id, name, description, tags);

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

module.exports = {
  uploadDocument,
  getDocumentDetails,
  downloadDocument,
  previewDocument,
  updateDocument,
  lockDocument,
  archiveDocument,
  favoriteDocument,
  softDeleteDocument,
  copyDocument,
  moveDocument,
  getVersionHistory,
  convertDocument,
  restoreDocumentVersion
};
