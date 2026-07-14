const path = require('path');
const fs = require('fs');
const https = require('https');

// Dashboard statistics
const getDashboardStats = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const objectIdUserId = new (require('mongoose').Types.ObjectId)(userId);

    const totalDocs = await req.Document.countDocuments({ tenantId, isDeleted: false, isArchived: false });
    const totalFolders = await req.Folder.countDocuments({ tenantId, isDeleted: false, isArchived: false });
    const favoriteCount = await req.Favorite.countDocuments({ tenantId, userId });

    const sharedCount = await req.Share.countDocuments({
      tenantId,
      sharingType: 'Internal',
      $or: [
        { sharedWithViewers: objectIdUserId },
        { sharedWithViewers: { $exists: true, $size: 0 } },
        { sharedWithViewers: { $exists: false } }
      ]
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentUploadsCount = await req.Document.countDocuments({
      tenantId,
      isDeleted: false,
      isArchived: false,
      createdAt: { $gte: sevenDaysAgo }
    });

    const recentDocs = await req.Document.find({ tenantId, isDeleted: false, isArchived: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({ path: 'uploadedBy', model: req.User, select: 'name' })
      .select('-password');

    const recentSharedWithMe = await req.Share.find({
      tenantId,
      sharingType: 'Internal',
      $or: [
        { sharedWithViewers: objectIdUserId },
        { sharedWithViewers: { $exists: true, $size: 0 } },
        { sharedWithViewers: { $exists: false } }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate('documentId', 'originalFileName fileType')
      .populate('folderId', 'name')
      .populate({ path: 'sharedBy', model: req.User, select: 'name' });

    const teamMembers = await req.User.find({})
      .select('name email role isActive lastLogin')
      .limit(5);

    const currentUser = await req.User.findById(userId).select('name');
    const accountHolderName = currentUser ? currentUser.name : 'Viewer';

    const docTypeBreakdown = await req.Document.aggregate([
      { $match: { tenantId, isDeleted: false, isArchived: false } },
      { $group: { _id: '$fileType', count: { $sum: 1 }, totalSize: { $sum: '$fileSize' } } },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      message: 'Viewer dashboard statistics retrieved successfully.',
      data: {
        totalDocuments: totalDocs,
        totalFolders,
        sharedCount,
        recentUploadsCount,
        favoriteDocumentsCount: favoriteCount,
        recentDocuments: recentDocs,
        recentSharedWithMe,
        teamMembers,
        docTypeBreakdown,
        accountHolderName
      },
      errors: null
    });
  } catch (err) { next(err); }
};

// Folders Tree hierarchy
const getFolderTree = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const folders = await req.Folder.find({ tenantId, isDeleted: false }).lean();

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
          rootFolders.push(f);
        }
      } else {
        rootFolders.push(f);
      }
    });

    res.status(200).json({
      success: true,
      message: 'Folder tree retrieved successfully.',
      data: rootFolders,
      errors: null
    });
  } catch (err) { next(err); }
};

// Folder Contents (Child Folders and Documents)
const getFolderDetails = async (req, res, next) => {
  try {
    const Folder = req.Folder;
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const folder = await Folder.findOne({ _id: req.params.id, tenantId, isDeleted: false });
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const childFolders = await Folder.find({ parentFolder: folder._id, tenantId, isDeleted: false });
    const documents = await Document.find({ folderId: folder._id, tenantId, isDeleted: false });

    res.status(200).json({
      success: true,
      message: 'Folder details retrieved successfully.',
      data: {
        folder,
        childFolders,
        documents
      },
      errors: null
    });
  } catch (err) { next(err); }
};

// Document details & versions
const getDocumentDetails = async (req, res, next) => {
  try {
    const Document = req.Document;
    const Version = req.Version;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

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

// Download Document
const downloadDocument = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Only enforce share checks for Viewers
    if (req.user.role === 'Viewer') {
      const Share = req.Share;
      const userId = req.user.userId;

      const share = await Share.findOne({
        tenantId,
        sharingType: 'Internal',
        $or: [
          { documentId: doc._id },
          { folderId: doc.folderId }
        ],
        sharedWithViewers: new (require('mongoose').Types.ObjectId)(userId)
      });

      if (!share) {
        return res.status(403).json({ success: false, message: 'Access denied. This file has not been shared with you.' });
      }

      if (!share.permissions.download) {
        return res.status(403).json({ success: false, message: 'Download is disabled for this file.' });
      }
    }

    doc.downloadCount += 1;
    await doc.save();

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

// Preview Document
const previewDocument = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const doc = await Document.findOne({ _id: req.params.id, tenantId, isDeleted: false });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Only enforce share checks for Viewers
    if (req.user.role === 'Viewer') {
      const Share = req.Share;
      const userId = req.user.userId;

      const share = await Share.findOne({
        tenantId,
        sharingType: 'Internal',
        $or: [
          { documentId: doc._id },
          { folderId: doc.folderId }
        ],
        sharedWithViewers: new (require('mongoose').Types.ObjectId)(userId)
      });

      if (!share) {
        return res.status(403).json({ success: false, message: 'Access denied. This file has not been shared with you.' });
      }
    }

    if (doc.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', doc.storageUrl);
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        return res.sendFile(filePath);
      }
      return res.status(404).json({ success: false, message: 'Physical file not found locally' });
    } else {
      return res.redirect(doc.storageUrl);
    }
  } catch (err) { next(err); }
};

// Global Search
const globalSearch = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const { 
      query, 
      fileType, 
      startDate, 
      endDate, 
      folderId, 
      status, 
      isFavorite, 
      sortBy, 
      order, 
      page = 1, 
      limit = 10 
    } = req.query;

    const skip = (page - 1) * limit;

    const docFilter = { tenantId, isDeleted: false, isArchived: false };
    
    if (query) {
      docFilter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { originalFileName: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } },
        { description: { $regex: query, $options: 'i' } }
      ];
    }
    
    if (fileType) docFilter.fileType = fileType.toUpperCase();
    if (folderId) docFilter.folderId = folderId;
    if (status) docFilter.status = status;

    if (startDate || endDate) {
      docFilter.createdAt = {};
      if (startDate) docFilter.createdAt.$gte = new Date(startDate);
      if (endDate) docFilter.createdAt.$lte = new Date(endDate);
    }

    if (isFavorite === 'true') {
      const favorites = await req.Favorite.find({ userId: req.user.userId, tenantId });
      const favDocIds = favorites.map(f => f.documentId);
      docFilter._id = { $in: favDocIds };
    }

    const sortOption = {};
    const sortFieldMap = {
      name: 'name',
      uploadDate: 'createdAt',
      modifiedDate: 'updatedAt',
      fileSize: 'fileSize',
      fileType: 'fileType'
    };
    const sortField = sortFieldMap[sortBy] || 'createdAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    sortOption[sortField] = sortOrder;

    const totalDocs = await req.Document.countDocuments(docFilter);
    const documents = await req.Document.find(docFilter)
      .sort(sortOption)
      .skip(Number(skip))
      .limit(Number(limit));

    let folders = [];
    if (!fileType && isFavorite !== 'true') {
      const folderFilter = { tenantId, isDeleted: false };
      if (query) {
        folderFilter.$or = [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ];
      }
      folders = await req.Folder.find(folderFilter)
        .sort({ name: sortOrder })
        .limit(Number(limit));
    }

    res.status(200).json({
      success: true,
      message: 'Search completed successfully.',
      data: {
        documents,
        folders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          totalDocuments: totalDocs,
          totalPages: Math.ceil(totalDocs / limit)
        }
      },
      errors: null
    });
  } catch (err) { next(err); }
};

// Favorites
const getFavorites = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;

    const favorites = await req.Favorite.find({ tenantId, userId })
      .populate({
        path: 'documentId',
        populate: { path: 'folderId' }
      });
    const documents = favorites.map(f => f.documentId).filter(d => d && !d.isDeleted);

    res.status(200).json({
      success: true,
      message: 'Favorite documents list retrieved.',
      data: documents,
      errors: null
    });
  } catch (err) { next(err); }
};

const toggleFavorite = async (req, res, next) => {
  try {
    const Favorite = req.Favorite;
    const Document = req.Document;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const { documentId } = req.params;
    const { isFavorite } = req.body;

    const doc = await Document.findOne({ _id: documentId, tenantId, isDeleted: false });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    if (isFavorite) {
      await Favorite.findOneAndUpdate(
        { userId, documentId: doc._id, tenantId },
        {},
        { upsert: true }
      );
    } else {
      await Favorite.deleteOne({ userId, documentId: doc._id, tenantId });
    }

    res.status(200).json({
      success: true,
      message: isFavorite ? 'Added to favorites.' : 'Removed from favorites.',
      data: {},
      errors: null
    });
  } catch (err) { next(err); }
};

// Secure Share Link Resolution with Password validation
const resolveShareLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query;
    const Share = req.Share;
    const Document = req.Document;

    const share = await Share.findOne({ shareLink: token });
    if (!share) return res.status(404).json({ success: false, message: 'Share link not found' });

    // Expiry Check
    if (share.expiryDate && new Date(share.expiryDate) < new Date()) {
      return res.status(410).json({ success: false, message: 'Share link has expired' });
    }

    // Password Check
    if (share.isPasswordProtected) {
      if (!password) {
        return res.status(401).json({
          success: false,
          message: 'Password required to access this file',
          data: { isPasswordProtected: true },
          errors: null
        });
      }
      const isMatch = await share.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid password provided' });
      }
    }

    const doc = await Document.findById(share.documentId).select('-password');
    if (!doc || doc.isDeleted) {
      return res.status(404).json({ success: false, message: 'Document is no longer available' });
    }

    res.status(200).json({
      success: true,
      message: 'Share link resolved successfully.',
      data: {
        document: doc,
        permissions: share.permissions
      },
      errors: null
    });
  } catch (err) { next(err); }
};

// Download Shared Document
const downloadSharedFile = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query;
    const Share = req.Share;
    const Document = req.Document;

    const share = await Share.findOne({ shareLink: token });
    if (!share) return res.status(404).json({ success: false, message: 'Share link not found' });

    if (share.expiryDate && new Date(share.expiryDate) < new Date()) {
      return res.status(410).json({ success: false, message: 'Share link has expired' });
    }

    // Download Permission Check
    if (!share.permissions.download) {
      return res.status(403).json({ success: false, message: 'Download permission is disabled for this link' });
    }

    if (share.isPasswordProtected) {
      if (!password) return res.status(401).json({ success: false, message: 'Password required' });
      const isMatch = await share.comparePassword(password);
      if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const doc = await Document.findById(share.documentId);
    if (!doc || doc.isDeleted) return res.status(404).json({ success: false, message: 'Document is not available' });

    doc.downloadCount += 1;
    await doc.save();

    if (doc.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', doc.storageUrl);
      if (fs.existsSync(filePath)) {
        return res.download(filePath, doc.originalFileName);
      }
      return res.status(404).json({ success: false, message: 'File asset not found locally' });
    } else {
      return res.redirect(doc.storageUrl);
    }
  } catch (err) { next(err); }
};

// Get all documents for viewer
const getAllDocuments = async (req, res, next) => {
  try {
    const Document = req.Document;
    const Favorite = req.Favorite;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;

    const documents = await Document.find({ tenantId, isDeleted: false, isArchived: false })
      .populate('folderId')
      .lean();
    const favorites = await Favorite.find({ tenantId, userId });
    const favSet = new Set(favorites.map(f => f.documentId.toString()));

    const data = documents.map(doc => ({
      ...doc,
      favorite: favSet.has(doc._id.toString()),
      folderName: doc.folderId ? doc.folderId.name : 'Root'
    }));

    res.status(200).json({
      success: true,
      message: 'All documents retrieved successfully.',
      data,
      errors: null
    });
  } catch (err) { next(err); }
};

const getSharedWithMe = async (req, res, next) => {
  try {
    const Share = req.Share;
    const Document = req.Document;
    const Folder = req.Folder;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const now = new Date();

    const shares = await Share.find({
      tenantId,
      sharingType: 'Internal',
      $or: [
        { sharedWithViewers: new (require('mongoose').Types.ObjectId)(userId) },
        { sharedWithViewers: { $exists: true, $size: 0 } },
        { sharedWithViewers: { $exists: false } }
      ],
      $and: [
        {
          $or: [
            { expiryDate: null },
            { expiryDate: { $gt: now } }
          ]
        }
      ]
    })
    .populate({
      path: 'documentId',
      populate: { path: 'folderId' }
    })
    .populate('folderId')
    .populate({ path: 'sharedBy', model: req.User, select: 'name email' })
    .lean();

    const items = shares.map(share => {
      if (share.documentId) {
        return {
          _id: share.documentId._id,
          name: share.documentId.name,
          fileType: share.documentId.fileType,
          fileSize: share.documentId.fileSize,
          sharedBy: share.sharedBy ? share.sharedBy.name : 'System',
          sharedByEmail: share.sharedBy ? share.sharedBy.email : '',
          folderName: share.documentId.folderId ? share.documentId.folderId.name : 'Root',
          createdAt: share.createdAt,
          downloadPermission: share.permissions.download,
          uploadPermission: false,
          shareLinkToken: share.shareLink,
          isFolder: false
        };
      } else if (share.folderId) {
        return {
          _id: share.folderId._id,
          name: share.folderId.name,
          fileType: 'Folder',
          fileSize: 0,
          sharedBy: share.sharedBy ? share.sharedBy.name : 'System',
          sharedByEmail: share.sharedBy ? share.sharedBy.email : '',
          folderName: '',
          createdAt: share.createdAt,
          downloadPermission: share.permissions.download,
          uploadPermission: share.permissions.uploadAllowed || false,
          shareLinkToken: share.shareLink,
          isFolder: true
        };
      }
      return null;
    }).filter(Boolean);

    res.status(200).json({
      success: true,
      message: 'Shared items retrieved successfully.',
      data: items,
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  getDashboardStats,
  getFolderTree,
  getFolderDetails,
  getDocumentDetails,
  downloadDocument,
  previewDocument,
  globalSearch,
  getFavorites,
  toggleFavorite,
  resolveShareLink,
  downloadSharedFile,
  getAllDocuments,
  getSharedWithMe
};
