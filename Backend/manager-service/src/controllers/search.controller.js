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
      limit = 10 
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query filters for Document
    const docFilter = { tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      docFilter.uploadedBy = req.user.userId;
    }
    
    if (query) {
      docFilter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { originalFileName: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } },
        { description: { $regex: query, $options: 'i' } }
      ];
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
    if (query) {
      folderFilter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } }
      ];
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

module.exports = {
  globalSearch
};
