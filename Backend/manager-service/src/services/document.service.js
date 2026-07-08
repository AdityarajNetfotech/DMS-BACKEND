const path = require('path');
const fs = require('fs');
const storageHelper = require('../helpers/storage.helper');
const storageService = require('./storage.service');
const activityService = require('./activity.service');

const uploadDocument = async (req, folderId, file, name, description, tags = []) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const Version = req.Version;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const ext = path.extname(file.originalname);
  const docName = name || path.basename(file.originalname, ext);

  // Check if document with the same name exists in the folder
  let document = await Document.findOne({ name: docName, folderId: folderId || null, tenantId, isDeleted: false });

  if (document) {
    // If locked, reject modification
    if (document.isLocked) {
      throw new Error('Document is locked and cannot be updated.');
    }

    // Check storage limits first
    await storageService.checkAndIncrementStorage(req, file.size);

    // Save CURRENT document state as a history Version before updating
    const versionHistory = new Version({
      tenantId,
      documentId: document._id,
      versionNumber: document.versionNumber,
      fileName: document.originalFileName,
      fileSize: document.fileSize,
      storageUrl: document.storageUrl,
      uploadedBy: document.uploadedBy
    });
    await versionHistory.save();

    // Upload the new file asset
    const uploadResult = await storageHelper.uploadToStorage(file);

    // Update document to new state
    document.versionNumber += 1;
    document.originalFileName = file.originalname;
    document.fileSize = file.size;
    document.storageUrl = uploadResult.url;
    document.uploadedBy = userId;
    if (description) document.description = description;
    if (tags && tags.length > 0) document.tags = tags;
    
    await document.save();

    await activityService.logActivity(req, 'Document Version Updated', 'Document', document._id);
    return { document, isNewVersion: true };
  } else {
    // Check storage limits
    await storageService.checkAndIncrementStorage(req, file.size);

    // Upload the file asset
    const uploadResult = await storageHelper.uploadToStorage(file);

    document = new Document({
      name: docName,
      originalFileName: file.originalname,
      fileType: ext.replace('.', '').toUpperCase(),
      mimeType: file.mimetype,
      extension: ext,
      folderId: folderId || null,
      tenantId,
      uploadedBy: userId,
      managerId: userId,
      fileSize: file.size,
      storageUrl: uploadResult.url,
      description,
      tags,
      departmentId: req.user.departmentId || null
    });

    await document.save();

    // Update folder doc counter if inside a folder
    if (folderId) {
      await Folder.findByIdAndUpdate(folderId, { $inc: { totalDocuments: 1 } });
    }

    await activityService.logActivity(req, 'Document Uploaded', 'Document', document._id);
    return { document, isNewVersion: false };
  }
};

const updateDocumentDetails = async (req, docId, name, description, tags) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.departmentId = req.user.departmentId || null;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked and cannot be modified');

  if (name) doc.name = name;
  if (description) doc.description = description;
  if (tags) doc.tags = tags;

  await doc.save();
  await activityService.logActivity(req, 'Document Updated', 'Document', doc._id);
  return doc;
};

const toggleLockDocument = async (req, docId, isLocked) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.departmentId = req.user.departmentId || null;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');

  doc.isLocked = isLocked;
  doc.lockedBy = isLocked ? req.user.userId : null;
  await doc.save();

  const action = isLocked ? 'Document Locked' : 'Document Unlocked';
  await activityService.logActivity(req, action, 'Document', doc._id);
  return doc;
};

const toggleArchiveDocument = async (req, docId, isArchived) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.departmentId = req.user.departmentId || null;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked');

  doc.isArchived = isArchived;
  doc.archivedAt = isArchived ? new Date() : null;
  doc.status = isArchived ? 'Archived' : 'Active';
  await doc.save();

  const action = isArchived ? 'Document Archived' : 'Document Restored from Archive';
  await activityService.logActivity(req, action, 'Document', doc._id);
  return doc;
};

const toggleFavoriteDocument = async (req, docId, isFavorite) => {
  const Favorite = req.Favorite;
  const Document = req.Document;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.departmentId = req.user.departmentId || null;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');

  if (isFavorite) {
    await Favorite.findOneAndUpdate(
      { userId, documentId: doc._id, tenantId },
      {},
      { upsert: true }
    );
  } else {
    await Favorite.deleteOne({ userId, documentId: doc._id, tenantId });
  }

  return doc;
};

const softDeleteDocument = async (req, docId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.departmentId = req.user.departmentId || null;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked and cannot be deleted');

  doc.isDeleted = true;
  doc.deletedAt = new Date();
  await doc.save();

  if (doc.folderId) {
    await Folder.findByIdAndUpdate(doc.folderId, { $inc: { totalDocuments: -1 } });
  }

  const trash = new Trash({
    tenantId,
    resourceType: 'Document',
    resourceId: doc._id,
    deletedBy: userId,
    originalParentId: doc.folderId
  });
  await trash.save();

  await activityService.logActivity(req, 'Document Deleted', 'Document', doc._id);
};

const restoreDocument = async (req, docId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: true };
  if (req.user.role !== 'Tenant Admin') {
    query.departmentId = req.user.departmentId || null;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found in Trash');

  // Find or create "Trash" folder at root level (safely handling soft-deleted duplicates)
  let trashFolder = await Folder.findOne({ tenantId, name: 'Trash', parentFolder: null });
  if (!trashFolder) {
    trashFolder = new Folder({
      name: 'Trash',
      parentFolder: null,
      tenantId,
      createdBy: req.user.userId,
      isDeleted: false
    });
    await trashFolder.save();
    await activityService.logActivity(req, 'Folder Created', 'Folder', trashFolder._id);
  } else if (trashFolder.isDeleted) {
    trashFolder.isDeleted = false;
    trashFolder.deletedAt = null;
    await trashFolder.save();
  }

  doc.folderId = trashFolder._id;
  doc.isDeleted = false;
  doc.deletedAt = null;
  await doc.save();

  await Folder.findByIdAndUpdate(trashFolder._id, { $inc: { totalDocuments: 1 } });

  await Trash.deleteOne({ tenantId, resourceType: 'Document', resourceId: doc._id });

  await activityService.logActivity(req, 'Document Restored', 'Document', doc._id);
};

const permanentlyDeleteDocument = async (req, docId) => {
  const Document = req.Document;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: true });
  if (!doc) throw new Error('Document not found in Trash');

  // Decrement storage
  await storageService.decrementStorage(req, doc.fileSize);

  // Delete physical storage asset
  await storageHelper.deleteFromStorage(doc.storageUrl);

  // Clean relations
  await req.Version.deleteMany({ documentId: doc._id });
  await req.Favorite.deleteMany({ documentId: doc._id });
  await req.Share.deleteMany({ documentId: doc._id });

  await Document.findByIdAndDelete(doc._id);
  await Trash.deleteOne({ tenantId, resourceType: 'Document', resourceId: doc._id });

  await activityService.logActivity(req, 'Document Permanently Deleted', 'Document', doc._id);
};

const copyDocument = async (req, docId, targetFolderId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');

  // Storage check
  await storageService.checkAndIncrementStorage(req, doc.fileSize);

  // For simplicity, copy points to the same underlying physical asset but tracks separately.
  // In a full system, you could duplicate the physical file. Pointing to the same URL is fine.
  const newDoc = new Document({
    name: doc.name + ' - Copy',
    originalFileName: doc.originalFileName,
    fileType: doc.fileType,
    mimeType: doc.mimeType,
    extension: doc.extension,
    folderId: targetFolderId || null,
    tenantId,
    uploadedBy: userId,
    managerId: userId,
    fileSize: doc.fileSize,
    storageUrl: doc.storageUrl,
    description: doc.description,
    tags: doc.tags
  });

  await newDoc.save();

  if (targetFolderId) {
    await Folder.findByIdAndUpdate(targetFolderId, { $inc: { totalDocuments: 1 } });
  }

  await activityService.logActivity(req, 'Document Copied', 'Document', newDoc._id);
  return newDoc;
};

const moveDocument = async (req, docId, targetFolderId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked');

  const oldFolderId = doc.folderId;
  doc.folderId = targetFolderId || null;
  await doc.save();

  // Update folder counters
  if (oldFolderId) {
    await Folder.findByIdAndUpdate(oldFolderId, { $inc: { totalDocuments: -1 } });
  }
  if (targetFolderId) {
    await Folder.findByIdAndUpdate(targetFolderId, { $inc: { totalDocuments: 1 } });
  }

  await activityService.logActivity(req, 'Document Moved', 'Document', doc._id);
  return doc;
};

module.exports = {
  uploadDocument,
  updateDocumentDetails,
  toggleLockDocument,
  toggleArchiveDocument,
  toggleFavoriteDocument,
  softDeleteDocument,
  restoreDocument,
  permanentlyDeleteDocument,
  copyDocument,
  moveDocument
};
