const getArchivedItems = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const folderQuery = { tenantId, isArchived: true, isDeleted: false };
    const docQuery = { tenantId, isArchived: true, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      folderQuery.createdBy = req.user.userId;
      docQuery.uploadedBy = req.user.userId;
    }

    const folders = await req.Folder.find(folderQuery)
      .populate('createdBy', 'name')
      .populate('departmentId', 'name');
    const documents = await req.Document.find(docQuery)
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    res.status(200).json({
      success: true,
      message: 'Archived items retrieved successfully.',
      data: {
        folders,
        documents
      },
      errors: null
    });
  } catch (err) { next(err); }
};

const verifyArchivePassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    const userId = req.user.userId;

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const user = await req.User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    res.status(200).json({
      success: true,
      message: 'Archive access verified successfully.',
      data: null,
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  getArchivedItems,
  verifyArchivePassword
};
