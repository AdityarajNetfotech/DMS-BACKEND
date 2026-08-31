const calculateFolderSize = async (folderId, Folder, Document, tenantId) => {
  let size = 0;
  const docs = await Document.find({ folderId, tenantId, isDeleted: false }, 'fileSize');
  for (const doc of docs) {
    size += doc.fileSize || 0;
  }
  const subFolders = await Folder.find({ parentFolder: folderId, tenantId, isDeleted: false }, '_id');
  for (const sub of subFolders) {
    size += await calculateFolderSize(sub._id, Folder, Document, tenantId);
  }
  return size;
};

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
      isArchived, 
      isLocked, 
      sortBy, 
      order, 
      page = 1, 
      limit = 10,
      customerOrFilename,
      idQuery
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query filters for Document
    const docFilter = { tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      docFilter.uploadedBy = req.user.userId;
    }
    
    const conditions = [];

    if (query) {
      conditions.push({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { originalFileName: { $regex: query, $options: 'i' } },
          { tags: { $in: [new RegExp(query, 'i')] } },
          { description: { $regex: query, $options: 'i' } },
          { extractedText: { $regex: query, $options: 'i' } }
        ]
      });
    }

    if (customerOrFilename) {
      const User = req.User || req.tenantDb.model('User');
      const users = await User.find({ name: { $regex: customerOrFilename, $options: 'i' } }, '_id');
      const userIds = users.map(u => u._id);
      conditions.push({
        $or: [
          { name: { $regex: customerOrFilename, $options: 'i' } },
          { originalFileName: { $regex: customerOrFilename, $options: 'i' } },
          { uploadedBy: { $in: userIds } }
        ]
      });
    }

    if (idQuery) {
      const mongoose = require('mongoose');
      const idList = idQuery.split(',').map(id => id.trim()).filter(id => mongoose.Types.ObjectId.isValid(id));
      if (idList.length > 0) {
        const objIds = idList.map(id => new mongoose.Types.ObjectId(id));
        conditions.push({
          $or: [
            { _id: { $in: objIds } },
            { uploadedBy: { $in: objIds } }
          ]
        });
      } else {
        conditions.push({ _id: null });
      }
    }

    if (conditions.length > 0) {
      docFilter.$and = conditions;
    }
    
    if (fileType) {
      docFilter.fileType = fileType.toUpperCase();
    }
    
    if (folderId) {
      docFilter.folderId = folderId;
    }
    
    if (status) {
      docFilter.status = status;
    }
    
    if (isArchived !== undefined) {
      docFilter.isArchived = isArchived === 'true';
    }
    
    if (isLocked !== undefined) {
      docFilter.isLocked = isLocked === 'true';
    }

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

    // Build query filters for Folder
    const folderFilter = { tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      folderFilter.createdBy = req.user.userId;
    }

    const folderConditions = [];

    if (query) {
      folderConditions.push({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      });
    }

    if (customerOrFilename) {
      const User = req.User || req.tenantDb.model('User');
      const users = await User.find({ name: { $regex: customerOrFilename, $options: 'i' } }, '_id');
      const userIds = users.map(u => u._id);
      folderConditions.push({
        $or: [
          { name: { $regex: customerOrFilename, $options: 'i' } },
          { createdBy: { $in: userIds } }
        ]
      });
    }

    if (idQuery) {
      const mongoose = require('mongoose');
      const idList = idQuery.split(',').map(id => id.trim()).filter(id => mongoose.Types.ObjectId.isValid(id));
      if (idList.length > 0) {
        const objIds = idList.map(id => new mongoose.Types.ObjectId(id));
        folderConditions.push({
          $or: [
            { _id: { $in: objIds } },
            { createdBy: { $in: objIds } }
          ]
        });
      } else {
        folderConditions.push({ _id: null });
      }
    }

    if (folderConditions.length > 0) {
      folderFilter.$and = folderConditions;
    }

    if (folderId) {
      folderFilter.parentFolder = folderId;
    }

    // Build Sorting Options
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
      .limit(Number(limit))
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    // Retrieve matching folders if not strictly looking for specific file attributes
    let folders = [];
    if (!fileType && isFavorite !== 'true' && isArchived !== 'true' && isLocked !== 'true') {
      const rawFolders = await req.Folder.find(folderFilter)
        .sort({ name: sortOrder })
        .limit(Number(limit))
        .populate('createdBy', 'name')
        .populate('departmentId', 'name');
        
      for (const f of rawFolders) {
        const size = await calculateFolderSize(f._id, req.Folder, req.Document, tenantId);
        const plainFolder = f.toObject();
        plainFolder.fileSize = size;
        folders.push(plainFolder);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Global search completed successfully.',
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

const listDocumentIds = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const { page = 1, limit = 5, search } = req.query;
    const skip = (page - 1) * limit;

    const filter = { tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      filter.uploadedBy = req.user.userId;
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { originalFileName: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await req.Document.countDocuments(filter);
    const documents = await req.Document.find(filter, '_id name originalFileName fileType')
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      data: {
        documents: documents.map(d => ({
          _id: d._id,
          name: d.name,
          originalFileName: d.originalFileName,
          fileType: d.fileType
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) { next(err); }
};

module.exports = {
  globalSearch,
  listDocumentIds
};
