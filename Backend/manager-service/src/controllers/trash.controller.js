const folderService = require('../services/folder.service');
const documentService = require('../services/document.service');

const getTrashList = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;

    const deptFilter = req.user.role === 'Tenant Admin' ? undefined : (req.user.departmentId || null);
    const query = { tenantId, isDeleted: true };
    if (deptFilter !== undefined) query.departmentId = deptFilter;

    const folders = await req.Folder.find(query)
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    const documents = await req.Document.find(query)
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    res.status(200).json({
      success: true,
      message: 'Trash contents retrieved successfully.',
      data: {
        folders,
        documents
      },
      errors: null
    });
  } catch (err) { next(err); }
};

const restoreResource = async (req, res, next) => {
  try {
    const { id } = req.params;
    const Trash = req.Trash;
    const tenantId = req.user.companySlug;

    const trashItem = await Trash.findOne({ resourceId: id, tenantId });
    if (!trashItem) return res.status(404).json({ success: false, message: 'Resource not found in Trash' });

    if (trashItem.resourceType === 'Folder') {
      await folderService.restoreFolder(req, id);
    } else {
      await documentService.restoreDocument(req, id);
    }

    res.status(200).json({
      success: true,
      message: 'Resource restored successfully.',
      data: {},
      errors: null
    });
  } catch (err) { next(err); }
};

const permanentlyDeleteResource = async (req, res, next) => {
  try {
    const { id } = req.params;
    const Trash = req.Trash;
    const tenantId = req.user.companySlug;

    const trashItem = await Trash.findOne({ resourceId: id, tenantId });
    if (!trashItem) return res.status(404).json({ success: false, message: 'Resource not found in Trash' });

    if (trashItem.resourceType === 'Folder') {
      await folderService.permanentlyDeleteFolder(req, id);
    } else {
      await documentService.permanentlyDeleteDocument(req, id);
    }

    res.status(200).json({
      success: true,
      message: 'Resource permanently deleted.',
      data: {},
      errors: null
    });
  } catch (err) { next(err); }
};

const emptyTrash = async (req, res, next) => {
  try {
    const Trash = req.Trash;
    const tenantId = req.user.companySlug;

    const trashItems = await Trash.find({ tenantId });

    for (const item of trashItems) {
      if (item.resourceType === 'Folder') {
        await folderService.permanentlyDeleteFolder(req, item.resourceId);
      } else {
        await documentService.permanentlyDeleteDocument(req, item.resourceId);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Trash emptied successfully.',
      data: {},
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  getTrashList,
  restoreResource,
  permanentlyDeleteResource,
  emptyTrash
};
