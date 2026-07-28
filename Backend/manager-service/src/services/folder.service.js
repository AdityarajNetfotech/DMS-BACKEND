const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const storageHelper = require('../helpers/storage.helper');
const storageService = require('./storage.service');
const activityService = require('./activity.service');
const logger = require('../config/logger');

// Recursive helper to soft delete children (both folders and documents)
const recursivelySoftDelete = async (req, parentId, deletedAt, session) => {
  // Update child folders
  const childFolders = await req.Folder.find({ parentFolder: parentId, isDeleted: false });
  for (const folder of childFolders) {
    folder.isDeleted = true;
    folder.deletedAt = deletedAt;
    await folder.save();
    await recursivelySoftDelete(req, folder._id, deletedAt, session);
  }

  // Update child documents
  await req.Document.updateMany(
    { folderId: parentId, isDeleted: false },
    { $set: { isDeleted: true, deletedAt } }
  );
};

// Recursive helper to restore children
const recursivelyRestore = async (req, parentId, session) => {
  const childFolders = await req.Folder.find({ parentFolder: parentId, isDeleted: true });
  for (const folder of childFolders) {
    folder.isDeleted = false;
    folder.deletedAt = null;
    await folder.save();
    await recursivelyRestore(req, folder._id, session);
  }

  await req.Document.updateMany(
    { folderId: parentId, isDeleted: true },
    { $set: { isDeleted: false, deletedAt: null } }
  );
};

// Recursive helper to permanently delete folders and release document storage
const recursivelyPermanentDelete = async (req, parentId) => {
  // Delete all child documents
  const documents = await req.Document.find({ folderId: parentId });
  for (const doc of documents) {
    // Release storage
    await storageService.decrementStorage(req, doc.fileSize);
    // Delete file
    await storageHelper.deleteFromStorage(doc.storageUrl);
    // Delete versions
    await req.Version.deleteMany({ documentId: doc._id });
    await req.Favorite.deleteMany({ documentId: doc._id });
    await req.Share.deleteMany({ documentId: doc._id });
    await req.Document.findByIdAndDelete(doc._id);
  }

  // Find child folders
  const childFolders = await req.Folder.find({ parentFolder: parentId });
  for (const folder of childFolders) {
    await recursivelyPermanentDelete(req, folder._id);
    await req.Folder.findByIdAndDelete(folder._id);
  }
};

// Recursive helper to add items to ZIP buffer
const collectZipItems = async (req, folderId, currentPath, zip) => {
  // Add documents in current folder
  const documents = await req.Document.find({ folderId, isDeleted: false });
  for (const doc of documents) {
    const zipFilePath = path.join(currentPath, doc.originalFileName);
    
    // We need to retrieve the file data buffer depending on storage url
    try {
      const fileBuffer = await downloadFileToBuffer(doc.storageUrl);
      zip.addFile(zipFilePath, fileBuffer);
      // Increment download counters
      doc.downloadCount += 1;
      await doc.save();
    } catch (err) {
      logger.error(`Failed to add file ${doc.originalFileName} to zip:`, err);
    }
  }

  // Recurse into child folders
  const childFolders = await req.Folder.find({ parentFolder: folderId, isDeleted: false });
  for (const folder of childFolders) {
    const nextPath = path.join(currentPath, folder.name);
    await collectZipItems(req, folder._id, nextPath, zip);
  }
};

// Utility to load storageUrl file directly into memory buffer
const downloadFileToBuffer = (fileUrl) => {
  return new Promise((resolve, reject) => {
    // If local file path
    if (fileUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', fileUrl);
      fs.readFile(filePath, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    } else {
      // If remote Cloudinary URL
      const client = fileUrl.startsWith('https') ? https : http;
      client.get(fileUrl, (res) => {
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => resolve(Buffer.concat(data)));
        res.on('error', (err) => reject(err));
      });
    }
  });
};

const createFolder = async (req, name, description, parentFolder, folderColor, folderIcon, files = []) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  // Validate Folder Name uniqueness under the parent folder
  const existing = await Folder.findOne({ name, parentFolder, tenantId, isDeleted: false });
  if (existing) {
    throw new Error('Folder with this name already exists in the selected directory');
  }

  const folder = new Folder({
    name,
    description,
    parentFolder: parentFolder || null,
    folderColor,
    folderIcon,
    tenantId,
    createdBy: userId,
    departmentId: req.user.departmentId || null
  });

  await folder.save();

  // If a parent folder was specified, increment parent counters
  if (parentFolder) {
    await Folder.findByIdAndUpdate(parentFolder, { $inc: { totalChildFolders: 1 } });
  }

  // Handle uploaded files mapping directly
  if (files && files.length > 0) {
    const Document = req.Document;
    for (const file of files) {
      // Validate storage limit allocation
      await storageService.checkAndIncrementStorage(req, file.size);

      // Upload file physically
      const uploadResult = await storageHelper.uploadToStorage(file);

      const ext = path.extname(file.originalname);
      const document = new Document({
        name: path.basename(file.originalname, ext),
        originalFileName: file.originalname,
        fileType: ext.replace('.', '').toUpperCase(),
        mimeType: file.mimetype,
        extension: ext,
        folderId: folder._id,
        tenantId,
        uploadedBy: userId,
        managerId: userId,
        fileSize: file.size,
        storageUrl: uploadResult.url,
        departmentId: req.user.departmentId || null
      });
      await document.save();
      folder.totalDocuments += 1;
    }
    await folder.save();
  }

  await activityService.logActivity(req, 'Folder Created', 'Folder', folder._id);

  return folder;
};

const getFolderTree = async (req) => {
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;
  const userRole = req.user.role;

  const query = { tenantId, isDeleted: false };
  if (userRole !== 'Tenant Admin') {
    query.createdBy = userId;
  }
  const folders = await req.Folder.find(query).lean();

  const folderMap = {};
  folders.forEach(f => {
    f.children = [];
    folderMap[f._id.toString()] = f;
  });

  const rootFolders = [];
  folders.forEach(f => {
    if (f.parentFolder) {
      const parent = folderMap[f.parentFolder.toString()];
      if (parent) {
        parent.children.push(f);
      } else {
        // If parent folder is deleted or not found, place in root
        rootFolders.push(f);
      }
    } else {
      rootFolders.push(f);
    }
  });

  return rootFolders;
};

const softDeleteFolder = async (req, folderId) => {
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: folderId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.createdBy = userId;
  }
  const folder = await Folder.findOne(query);
  if (!folder) throw new Error('Folder not found');

  const deletedAt = new Date();
  folder.isDeleted = true;
  folder.deletedAt = deletedAt;
  await folder.save();

  // Recursively delete children
  await recursivelySoftDelete(req, folder._id, deletedAt);

  // Decrement parent totalChildFolders count
  if (folder.parentFolder) {
    await Folder.findByIdAndUpdate(folder.parentFolder, { $inc: { totalChildFolders: -1 } });
  }

  // Create trash log entry
  const trash = new Trash({
    tenantId,
    resourceType: 'Folder',
    resourceId: folder._id,
    deletedBy: userId,
    originalParentId: folder.parentFolder
  });
  await trash.save();

  await activityService.logActivity(req, 'Folder Deleted', 'Folder', folder._id);
};

const restoreFolder = async (req, folderId) => {
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: folderId, tenantId, isDeleted: true };
  if (req.user.role !== 'Tenant Admin') {
    query.createdBy = userId;
  }
  const folder = await Folder.findOne(query);
  if (!folder) throw new Error('Folder not found in Trash');

  // Prevent moving "Trash" folder inside itself
  if (folder.name === 'Trash' && !folder.parentFolder) {
    folder.isDeleted = false;
    folder.deletedAt = null;
    await folder.save();
    await recursivelyRestore(req, folder._id);
    await Trash.deleteOne({ tenantId, resourceType: 'Folder', resourceId: folder._id });
    await activityService.logActivity(req, 'Folder Restored', 'Folder', folder._id);
    return;
  }

  // Find or create "Trash" folder at root level (safely handling soft-deleted duplicates)
  let trashFolder = await Folder.findOne({ tenantId, name: 'Trash', parentFolder: null, departmentId: req.user.departmentId || null });
  if (!trashFolder) {
    trashFolder = new Folder({
      name: 'Trash',
      parentFolder: null,
      tenantId,
      createdBy: req.user.userId,
      isDeleted: false,
      departmentId: req.user.departmentId || null
    });
    await trashFolder.save();
    await activityService.logActivity(req, 'Folder Created', 'Folder', trashFolder._id);
  } else if (trashFolder.isDeleted) {
    trashFolder.isDeleted = false;
    trashFolder.deletedAt = null;
    await trashFolder.save();
  }

  folder.parentFolder = trashFolder._id;
  folder.isDeleted = false;
  folder.deletedAt = null;
  await folder.save();

  // Recursively restore children
  await recursivelyRestore(req, folder._id);

  await Folder.findByIdAndUpdate(trashFolder._id, { $inc: { totalChildFolders: 1 } });

  await Trash.deleteOne({ tenantId, resourceType: 'Folder', resourceId: folder._id });

  await activityService.logActivity(req, 'Folder Restored', 'Folder', folder._id);
};

const permanentlyDeleteFolder = async (req, folderId) => {
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: true });
  if (!folder) throw new Error('Folder not found in Trash');

  // Recursively wipe children and release storage
  await recursivelyPermanentDelete(req, folder._id);

  // Wipe the folder itself
  await Folder.findByIdAndDelete(folder._id);

  await Trash.deleteOne({ tenantId, resourceType: 'Folder', resourceId: folder._id });

  await activityService.logActivity(req, 'Folder Permanently Deleted', 'Folder', folder._id);
};

const downloadZip = async (req, folderId) => {
  const Folder = req.Folder;
  const folder = await Folder.findOne({ _id: folderId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  const zip = new AdmZip();
  await collectZipItems(req, folder._id, folder.name, zip);

  await activityService.logActivity(req, 'Folder Downloaded (ZIP)', 'Folder', folder._id);

  return zip.toBuffer();
};

const toggleFolderLock = async (req, folderId, isLocked) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  folder.isLocked = isLocked;
  await folder.save();

  await activityService.logActivity(req, isLocked ? 'Folder Locked' : 'Folder Unlocked', 'Folder', folder._id);
  return folder;
};

const toggleFolderArchive = async (req, folderId, isArchived) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  folder.isArchived = isArchived;
  await folder.save();

  await activityService.logActivity(req, isArchived ? 'Folder Archived' : 'Folder Restored from Archive', 'Folder', folder._id);
  return folder;
};

const toggleFolderFavorite = async (req, folderId, isFavorite) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  folder.isFavorited = isFavorite;
  await folder.save();

  await activityService.logActivity(req, isFavorite ? 'Folder Favorited' : 'Folder Unfavorited', 'Folder', folder._id);
  return folder;
};

module.exports = {
  createFolder,
  getFolderTree,
  softDeleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
  downloadZip,
  toggleFolderLock,
  toggleFolderArchive,
  toggleFolderFavorite
};
