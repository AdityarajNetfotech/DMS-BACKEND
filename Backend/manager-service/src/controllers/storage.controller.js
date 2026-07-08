const storageService = require('../services/storage.service');

const calculateFolderSize = async (req, folderId) => {
  let size = 0;
  
  // Sum documents size
  const docs = await req.Document.find({ folderId, isDeleted: false });
  docs.forEach(d => { size += d.fileSize; });

  // Sum child folders size
  const childFolders = await req.Folder.find({ parentFolder: folderId, isDeleted: false });
  for (const child of childFolders) {
    size += await calculateFolderSize(req, child._id);
  }

  return size;
};

const getStorageSummary = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const usage = await storageService.getStorageUsage(req);

    // Fetch largest files
    const largestFiles = await req.Document.find({ tenantId, isDeleted: false })
      .sort({ fileSize: -1 })
      .limit(5)
      .select('-password');

    // Fetch storage analytics breakdown by fileType
    const breakdown = await req.Document.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$fileType', count: { $sum: 1 }, size: { $sum: '$fileSize' } } }
    ]);

    res.status(200).json({
      success: true,
      message: 'Storage analytics retrieved successfully.',
      data: {
        totalStorageUsed: usage.totalStorageUsed,
        maxStorageLimit: usage.maxStorageLimit,
        remainingStorage: usage.remainingStorage,
        largestFiles,
        fileTypeBreakdown: breakdown
      },
      errors: null
    });
  } catch (err) { next(err); }
};

const getFolderSize = async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const tenantId = req.user.companySlug;

    const folder = await req.Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const size = await calculateFolderSize(req, folder._id);

    res.status(200).json({
      success: true,
      message: 'Folder size calculated successfully.',
      data: {
        folderId: folder._id,
        folderName: folder.name,
        sizeInBytes: size,
        sizeInMegabytes: Math.round((size / (1024 * 1024)) * 100) / 100
      },
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  getStorageSummary,
  getFolderSize
};
