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

const getRecentItems = async (req, res, next) => {
  try {
    const Folder = req.Folder;
    const Document = req.Document;
    const tenantId = req.user.companySlug;

    const folderQuery = { tenantId, isDeleted: false };
    const docQuery = { tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      folderQuery.createdBy = req.user.userId;
      docQuery.uploadedBy = req.user.userId;
    }

    // Fetch latest 10 folders
    const folders = await Folder.find(folderQuery)
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('createdBy', 'name')
      .populate('departmentId', 'name')
      .lean();

    // Fetch latest 10 documents
    const documents = await Document.find(docQuery)
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name')
      .lean();

    // Format the items and calculate folder sizes
    const formattedFolders = [];
    for (const f of folders) {
      const size = await calculateFolderSize(f._id, Folder, Document, tenantId);
      formattedFolders.push({ ...f, kind: 'folder', type: 'Folder', fileSize: size });
    }
    
    // Helper to get file kind
    const getFileKind = (mimeType) => {
      if (!mimeType) return 'document';
      if (mimeType.includes('pdf')) return 'pdf';
      if (mimeType.includes('word') || mimeType.includes('document')) return 'word';
      if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'excel';
      if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'powerpoint';
      return 'document';
    };

    const formattedDocuments = documents.map(d => ({ ...d, kind: getFileKind(d.fileType), type: d.fileType || 'File' }));

    // Combine and sort
    const combined = [...formattedFolders, ...formattedDocuments]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 15); // Return the absolute latest 15 items overall

    return res.status(200).json({ success: true, data: combined });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getRecentItems
};
