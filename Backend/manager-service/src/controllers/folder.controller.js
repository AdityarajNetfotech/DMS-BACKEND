const folderService = require('../services/folder.service');
const { createFolderSchema, updateFolderSchema, moveFolderSchema } = require('../validators/manager.validator');

const createFolder = async (req, res, next) => {
  try {
    const { error, value } = createFolderSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const { name, description, parentFolder, folderColor, folderIcon } = value;
    const files = req.files || []; // Multer upload files array

    const folder = await folderService.createFolder(
      req,
      name,
      description,
      parentFolder,
      folderColor,
      folderIcon,
      files
    );

    res.status(201).json({
      success: true,
      message: 'Folder created successfully.',
      data: folder,
      errors: null
    });
  } catch (err) { next(err); }
};

const getFolderTree = async (req, res, next) => {
  try {
    const tree = await folderService.getFolderTree(req);
    res.status(200).json({
      success: true,
      message: 'Folder tree retrieved successfully.',
      data: tree,
      errors: null
    });
  } catch (err) { next(err); }
};

const calculateFolderSize = async (folderId, Folder, Document, tenantId) => {
  let size = 0;
  // Get all documents directly inside this folder
  const docs = await Document.find({ folderId, tenantId, isDeleted: false }, 'fileSize');
  for (const doc of docs) {
    size += doc.fileSize || 0;
  }
  // Get all child subfolders in this folder
  const subFolders = await Folder.find({ parentFolder: folderId, tenantId, isDeleted: false }, '_id');
  for (const sub of subFolders) {
    size += await calculateFolderSize(sub._id, Folder, Document, tenantId);
  }
  return size;
};

const getFolderDetails = async (req, res, next) => {
  try {
    const Folder = req.Folder;
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const deptFilter = req.user.role === 'Tenant Admin' ? undefined : (req.user.departmentId || null);

    if (req.params.id === 'root') {
      const folderQuery = { parentFolder: null, tenantId, isDeleted: false };
      if (deptFilter !== undefined) folderQuery.departmentId = deptFilter;

      const docQuery = { folderId: null, tenantId, isDeleted: false };
      if (deptFilter !== undefined) docQuery.departmentId = deptFilter;

      const childFolders = await Folder.find(folderQuery)
        .populate('createdBy', 'name')
        .populate('departmentId', 'name');
      const documents = await Document.find(docQuery)
        .populate('uploadedBy', 'name')
        .populate('departmentId', 'name');

      // Calculate sizes for childFolders
      const childFoldersWithSizes = [];
      for (const f of childFolders) {
        const size = await calculateFolderSize(f._id, Folder, Document, tenantId);
        const plainFolder = f.toObject();
        plainFolder.fileSize = size;
        childFoldersWithSizes.push(plainFolder);
      }

      return res.status(200).json({
        success: true,
        message: 'Root folder contents retrieved successfully.',
        data: {
          folder: null,
          childFolders: childFoldersWithSizes,
          documents
        },
        errors: null
      });
    }

    const folderQuery = { _id: req.params.id, tenantId, isDeleted: false };
    if (deptFilter !== undefined) folderQuery.departmentId = deptFilter;

    const folder = await Folder.findOne(folderQuery)
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const childFolders = await Folder.find({ parentFolder: folder._id, tenantId, isDeleted: false })
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    const documents = await Document.find({ folderId: folder._id, tenantId, isDeleted: false })
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    // Calculate sizes for childFolders
    const childFoldersWithSizes = [];
    for (const f of childFolders) {
      const size = await calculateFolderSize(f._id, Folder, Document, tenantId);
      const plainFolder = f.toObject();
      plainFolder.fileSize = size;
      childFoldersWithSizes.push(plainFolder);
    }

    res.status(200).json({
      success: true,
      message: 'Folder details retrieved successfully.',
      data: {
        folder,
        childFolders: childFoldersWithSizes,
        documents
      },
      errors: null
    });
  } catch (err) { next(err); }
};

const updateFolder = async (req, res, next) => {
  try {
    const { error, value } = updateFolderSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const Folder = req.Folder;
    const tenantId = req.user.companySlug;

    const query = { _id: req.params.id, tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      query.departmentId = req.user.departmentId || null;
    }

    const folder = await Folder.findOne(query);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const { name, description, folderColor, folderIcon } = value;
    if (name) folder.name = name;
    if (description) folder.description = description;
    if (folderColor) folder.folderColor = folderColor;
    if (folderIcon) folder.folderIcon = folderIcon;

    await folder.save();

    res.status(200).json({
      success: true,
      message: 'Folder updated successfully.',
      data: folder,
      errors: null
    });
  } catch (err) { next(err); }
};

const deleteFolder = async (req, res, next) => {
  try {
    await folderService.softDeleteFolder(req, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Folder soft-deleted successfully.',
      data: {},
      errors: null
    });
  } catch (err) { next(err); }
};

const moveFolder = async (req, res, next) => {
  try {
    const { error, value } = moveFolderSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const Folder = req.Folder;
    const tenantId = req.user.companySlug;
    const { targetFolderId } = value;

    const folder = await Folder.findOne({ _id: req.params.id, tenantId, isDeleted: false });
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    // Validate that we are not moving a folder into itself or its own children
    if (targetFolderId === req.params.id) {
      return res.status(400).json({ success: false, message: 'Cannot move folder into itself' });
    }

    const oldParent = folder.parentFolder;
    folder.parentFolder = targetFolderId || null;
    await folder.save();

    // Update child count counters
    if (oldParent) {
      await Folder.findByIdAndUpdate(oldParent, { $inc: { totalChildFolders: -1 } });
    }
    if (targetFolderId) {
      await Folder.findByIdAndUpdate(targetFolderId, { $inc: { totalChildFolders: 1 } });
    }

    res.status(200).json({
      success: true,
      message: 'Folder moved successfully.',
      data: folder,
      errors: null
    });
  } catch (err) { next(err); }
};

const downloadFolderZip = async (req, res, next) => {
  try {
    const zipBuffer = await folderService.downloadZip(req, req.params.id);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=folder-${req.params.id}.zip`);
    res.send(zipBuffer);
  } catch (err) { next(err); }
};

const lockFolder = async (req, res, next) => {
  try {
    const { lockFolderSchema } = require('../validators/manager.validator');
    const { error, value } = lockFolderSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const folder = await folderService.toggleFolderLock(req, req.params.id, value.isLocked);

    res.status(200).json({
      success: true,
      message: value.isLocked ? 'Folder locked successfully.' : 'Folder unlocked successfully.',
      data: folder,
      errors: null
    });
  } catch (err) { next(err); }
};

const archiveFolder = async (req, res, next) => {
  try {
    const { archiveFolderSchema } = require('../validators/manager.validator');
    const { error, value } = archiveFolderSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const folder = await folderService.toggleFolderArchive(req, req.params.id, value.isArchived);

    res.status(200).json({
      success: true,
      message: value.isArchived ? 'Folder archived successfully.' : 'Folder restored from archive.',
      data: folder,
      errors: null
    });
  } catch (err) { next(err); }
};

const favoriteFolder = async (req, res, next) => {
  try {
    const { favoriteFolderSchema } = require('../validators/manager.validator');
    const { error, value } = favoriteFolderSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const folder = await folderService.toggleFolderFavorite(req, req.params.id, value.isFavorite);

    res.status(200).json({
      success: true,
      message: value.isFavorite ? 'Folder added to favorites.' : 'Folder removed from favorites.',
      data: folder,
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  createFolder,
  getFolderTree,
  getFolderDetails,
  updateFolder,
  deleteFolder,
  moveFolder,
  downloadFolderZip,
  lockFolder,
  archiveFolder,
  favoriteFolder
};
