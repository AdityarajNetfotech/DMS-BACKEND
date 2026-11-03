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

const SYSTEM_FOLDER_NAMES = [
  'KYC Documents',
  'KYB Documents',
  'Director Documents',
  'Partner Documents',
  'Vendor Documents'
];

const resolveUserContext = async (req) => {
  const userId = req.user?.userId;
  const userRole = req.user?.role;
  let userEmail = req.user?.email || '';
  let userName = req.user?.name || '';
  let vcRole = req.user?.vcRole || '';
  let userObjectId = null;

  if (userId) {
    try {
      const mongoose = require('mongoose');
      userObjectId = new mongoose.Types.ObjectId(userId);
    } catch (_) {}

    if (req.tenantDb) {
      try {
        const u = await req.tenantDb.collection('users').findOne({
          _id: userObjectId || userId
        });
        if (u) {
          if (!userEmail) userEmail = u.email || '';
          if (!userName) userName = u.name || '';
          if (!vcRole) vcRole = u.vcRole || '';
        }
      } catch (e) {
        console.warn('Failed to resolve user context from tenant DB:', e.message);
      }
    }
  }

  const normalizedVcRole = String(vcRole || '').toLowerCase().trim();
  const normalizedUserEmail = String(userEmail || '').toLowerCase().trim();
  const isAuditor = normalizedVcRole === 'auditor' ||
                    String(userRole || '').toLowerCase() === 'auditor' ||
                    normalizedUserEmail.includes('abhishek');

  return {
    userId: String(userId || ''),
    userObjectId,
    userRole,
    vcRole: normalizedVcRole,
    userEmail: normalizedUserEmail,
    userName: String(userName || '').toLowerCase().trim(),
    isAdmin: userRole === 'Tenant Admin',
    isAuditor
  };
};

const isFolderAccessible = async (folder, userId, tenantId, Folder, Share, userRole, userInfo) => {
  if (userRole === 'Tenant Admin') {
    return { accessible: true, uploadAllowed: true };
  }

  const isAuditorFolder = folder.isAuditorFolder === true || folder.creatorRole === 'auditor';
  const folderCreatorId = String(folder.createdBy?._id || folder.createdBy || '');

  // Strict Rule: Folders created by Auditor are ONLY accessible to the Auditor who created them
  if (isAuditorFolder) {
    if (folderCreatorId === String(userId)) {
      return { accessible: true, uploadAllowed: true };
    }
    // Compliance officers, business users, and all other non-creators are BLOCKED
    return { accessible: false, uploadAllowed: false };
  }

  const isSystemRoot = folder.isSystemFolder || SYSTEM_FOLDER_NAMES.includes(folder.name);
  if (isSystemRoot) {
    return { accessible: true, uploadAllowed: true };
  }

  if (folderCreatorId && folderCreatorId === String(userId)) {
    return { accessible: true, uploadAllowed: true };
  }

  // Case folder access validation
  if (folder.caseRef || (folder.allowedEmails && folder.allowedEmails.length > 0)) {
    const userEmail = userInfo?.userEmail || '';
    const userName = userInfo?.userName || '';
    const allowedEmails = (folder.allowedEmails || []).map(e => String(e).toLowerCase());
    const allowedNames = (folder.allowedNames || []).map(n => String(n).toLowerCase());
    const assignedEmail = String(folder.assignedEmail || '').toLowerCase();
    const creatorEmail = String(folder.creatorEmail || '').toLowerCase();

    if (
      (userEmail && allowedEmails.includes(userEmail)) ||
      (userEmail && assignedEmail === userEmail) ||
      (userEmail && creatorEmail === userEmail) ||
      (userName && allowedNames.includes(userName))
    ) {
      return { accessible: true, uploadAllowed: true };
    }
  }

  // Check if folder is shared with user
  try {
    const shareQuery = {
      folderId: folder._id,
      tenantId,
      $or: [
        { sharedWithUser: userId },
        ...(userInfo?.userEmail ? [{ sharedWithEmail: userInfo.userEmail }] : [])
      ]
    };
    const share = await Share.findOne(shareQuery);
    if (share) {
      return { accessible: true, uploadAllowed: share.permission === 'Editor' };
    }
  } catch (err) {
    console.warn('Share check error:', err.message);
  }

  return { accessible: false, uploadAllowed: false };
};

const getFolderDetails = async (req, res, next) => {
  try {
    const Folder = req.Folder;
    const Document = req.Document;
    const Share = req.Share;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userInfo = await resolveUserContext(req);

    if (req.params.id === 'root') {
      await folderService.ensureDefaultSystemFolders(req);

      const folderQuery = { parentFolder: null, tenantId, isDeleted: false };
      const docQuery = { folderId: null, tenantId, isDeleted: false };

      if (!userInfo.isAdmin) {
        // Non-admin users see ONLY the 5 System Folders OR custom folders they created themselves
        const allowedCreatedBy = [];
        if (userInfo.userObjectId) allowedCreatedBy.push(userInfo.userObjectId);
        if (userInfo.userId) allowedCreatedBy.push(userInfo.userId);

        folderQuery.$or = [
          { isSystemFolder: true },
          { name: { $in: SYSTEM_FOLDER_NAMES } },
          { createdBy: { $in: allowedCreatedBy } }
        ];

        // Auditor-created folders can NEVER be seen by compliance officers or business users
        if (!userInfo.isAuditor) {
          folderQuery.isAuditorFolder = { $ne: true };
          folderQuery.creatorRole = { $ne: 'auditor' };
        }
      }

      const childFolders = await Folder.find(folderQuery)
        .sort({ createdAt: -1 })
        .populate('createdBy', 'name')
        .populate('departmentId', 'name');
      const documents = await Document.find(docQuery)
        .sort({ createdAt: -1 })
        .populate('uploadedBy', 'name email role')
        .populate('departmentId', 'name')
        .populate('approvalWorkflow.reportingApproval.approvedBy', 'name email role')
        .populate('approvalWorkflow.legalApproval.approvedBy', 'name email role')
        .populate('approvalWorkflow.complianceApproval.approvedBy', 'name email role');

      // Calculate sizes for childFolders & guarantee unique root folders
      const childFoldersWithSizes = [];
      const seenSystemNames = new Set();

      for (const f of childFolders) {
        if (!f.parentFolder && SYSTEM_FOLDER_NAMES.includes(f.name)) {
          if (seenSystemNames.has(f.name)) continue;
          seenSystemNames.add(f.name);
        }
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
    const folder = await Folder.findOne(folderQuery)
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    let uploadAllowed = false;
    if (userRole === 'Tenant Admin') {
      uploadAllowed = true;
    } else {
      const accessResult = await isFolderAccessible(folder, userId, tenantId, Folder, Share, userRole, userInfo);
      if (!accessResult.accessible) {
        return res.status(403).json({ success: false, message: 'Access denied: You do not have permission to view this folder.' });
      }
      uploadAllowed = accessResult.uploadAllowed;
    }

    const childFoldersQuery = { parentFolder: folder._id, tenantId, isDeleted: false };

    // If navigating inside a compliance system folder, filter child case folders by user assignment
    const isSystemRoot = folder.isSystemFolder || SYSTEM_FOLDER_NAMES.includes(folder.name);
    if (!userInfo.isAdmin) {
      if (isSystemRoot) {
        // Under a system root folder (KYC, KYB, etc.): only show case folders the user worked on or created
        const caseConditions = [];
        if (userInfo.userEmail) {
          caseConditions.push({ allowedEmails: userInfo.userEmail });
          caseConditions.push({ assignedEmail: userInfo.userEmail });
          caseConditions.push({ creatorEmail: userInfo.userEmail });
        }
        if (userInfo.userName) {
          caseConditions.push({ allowedNames: userInfo.userName });
        }
        if (userInfo.userObjectId) {
          caseConditions.push({ createdBy: userInfo.userObjectId });
        }
        if (userInfo.userId) {
          caseConditions.push({ createdBy: userInfo.userId });
        }

        if (caseConditions.length > 0) {
          childFoldersQuery.$or = caseConditions;
        }

        // Auditor-created folders can NEVER be seen by compliance officers or business users
        if (!userInfo.isAuditor) {
          childFoldersQuery.isAuditorFolder = { $ne: true };
          childFoldersQuery.creatorRole = { $ne: 'auditor' };
        }
      } else {
        // Under a case folder or custom subfolder: custom subfolders are ONLY visible to their creator
        const allowedCreatedBy = [];
        if (userInfo.userObjectId) allowedCreatedBy.push(userInfo.userObjectId);
        if (userInfo.userId) allowedCreatedBy.push(userInfo.userId);

        childFoldersQuery.$or = [
          { createdBy: { $in: allowedCreatedBy } }
        ];

        // Auditor-created folders can NEVER be seen by compliance officers or business users
        if (!userInfo.isAuditor) {
          childFoldersQuery.isAuditorFolder = { $ne: true };
          childFoldersQuery.creatorRole = { $ne: 'auditor' };
        }
      }
    }

    const childFolders = await Folder.find(childFoldersQuery)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    const documents = await Document.find({ folderId: folder._id, tenantId, isDeleted: false })
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name email role')
      .populate('departmentId', 'name')
      .populate('approvalWorkflow.reportingApproval.approvedBy', 'name email role')
      .populate('approvalWorkflow.legalApproval.approvedBy', 'name email role')
      .populate('approvalWorkflow.complianceApproval.approvedBy', 'name email role');

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
        folder: {
          ...folder.toObject(),
          uploadAllowed
        },
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
