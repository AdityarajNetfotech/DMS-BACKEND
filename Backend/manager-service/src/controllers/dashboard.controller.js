const storageService = require('../services/storage.service');

const getDashboardStats = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;

    const deptFilter = req.user.role === 'Tenant Admin' ? undefined : (req.user.departmentId || null);
    const docFilter = { tenantId, isDeleted: false };
    const folderFilter = { tenantId, isDeleted: false };
    const deletedDocFilter = { tenantId, isDeleted: true };
    const deletedFolderFilter = { tenantId, isDeleted: true };

    if (req.user.role !== 'Tenant Admin') {
      docFilter.uploadedBy = userId;
      folderFilter.createdBy = userId;
      deletedDocFilter.uploadedBy = userId;
      deletedFolderFilter.createdBy = userId;
    }

    const totalDocs = await req.Document.countDocuments(docFilter);
    const totalFolders = await req.Folder.countDocuments(folderFilter);
    const totalDeletedDocs = await req.Document.countDocuments(deletedDocFilter);
    const totalDeletedFolders = await req.Folder.countDocuments(deletedFolderFilter);

    const recentDocs = await req.Document.find(docFilter)
      .sort({ createdAt: -1 })
      .limit(7)
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    const recentModifiedDocs = await req.Document.find(docFilter)
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate('uploadedBy', 'name')
      .populate('departmentId', 'name');

    const favoriteCount = await req.Favorite.countDocuments({ tenantId, userId });

    const storageStats = await storageService.getStorageUsage(req);

    const activityQuery = { tenantId };
    if (req.user.role !== 'Tenant Admin') {
      activityQuery.userId = userId;
    }
    const recentActivities = await req.ActivityLog.find(activityQuery)
      .sort({ createdAt: -1 })
      .limit(10);

    // Count shared items
    const shareQuery = { tenantId };
    if (req.user.role !== 'Tenant Admin') {
      shareQuery.$or = [
        { sharedBy: userId },
        { sharedWithViewers: new (require('mongoose').Types.ObjectId)(userId) }
      ];
    }
    const sharedCount = await req.Share.countDocuments(shareQuery);

    // Get recent uploads (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const uploadQuery = {
      tenantId,
      isDeleted: false,
      createdAt: { $gte: sevenDaysAgo }
    };
    if (req.user.role !== 'Tenant Admin') {
      uploadQuery.uploadedBy = userId;
    }

    const recentUploadsCount = await req.Document.countDocuments(uploadQuery);

    // Get team members (filtered by department)
    const teamQuery = {};
    if (deptFilter !== undefined) teamQuery.departmentId = deptFilter;

    const teamMembers = await req.User.find(teamQuery)
      .select('name email role isActive lastLogin')
      .limit(10);

    // Get account holder name
    const currentUser = await req.User.findById(userId).select('name');
    const accountHolderName = currentUser ? currentUser.name : 'Manager';

    // Get restored count
    const restoredCount = await req.ActivityLog.countDocuments({
      tenantId,
      action: { $in: ['Folder Restored', 'Document Restored'] }
    });

    // Get notifications
    const notifications = await req.Notification.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(5);

    const matchQuery = { tenantId, isDeleted: false };
    if (req.user.role !== 'Tenant Admin') {
      matchQuery.uploadedBy = new (require('mongoose').Types.ObjectId)(userId);
    }

    // Get document type breakdown for storage overview
    const docTypeBreakdown = await req.Document.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$fileType', count: { $sum: 1 }, totalSize: { $sum: '$fileSize' } } },
      { $sort: { count: -1 } }
    ]);

    // Department storage breakdown
    const departmentBreakdown = await req.Document.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$departmentId', totalSize: { $sum: '$fileSize' } } },
      { $sort: { totalSize: -1 } },
      { $limit: 5 }
    ]);
    const departmentBreakdownWithNames = await Promise.all(
      departmentBreakdown.map(async (item) => {
        let deptName = 'Global / Unassigned';
        if (item._id) {
          const dept = await req.Department.findById(item._id).select('name');
          if (dept) deptName = dept.name;
        }
        return {
          name: deptName,
          totalSize: item.totalSize
        };
      })
    );

    // Top users by storage consumption
    const topUsersBreakdown = await req.Document.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$uploadedBy', totalSize: { $sum: '$fileSize' }, count: { $sum: 1 } } },
      { $sort: { totalSize: -1 } },
      { $limit: 5 }
    ]);
    const topUsersWithNames = await Promise.all(
      topUsersBreakdown.map(async (item) => {
        const user = await req.User.findById(item._id).select('name');
        return {
          name: user ? user.name : 'System / Manager',
          totalSize: item.totalSize,
          count: item.count
        };
      })
    );

    const data = {
      totalDocuments: totalDocs,
      totalFolders,
      totalUploadedDocuments: totalDocs,
      totalDeletedDocuments: totalDeletedDocs,
      totalDeletedFolders,
      recentDocuments: recentDocs,
      recentlyModifiedDocuments: recentModifiedDocs,
      favoriteDocumentsCount: favoriteCount,
      storageUsed: storageStats.totalStorageUsed,
      remainingStorage: storageStats.remainingStorage,
      maxStorageLimit: storageStats.maxStorageLimit,
      recentActivities,
      sharedCount,
      recentUploadsCount,
      teamMembers,
      notifications,
      docTypeBreakdown,
      departmentBreakdown: departmentBreakdownWithNames,
      topUsersBreakdown: topUsersWithNames,
      accountHolderName,
      restoredCount
    };

    res.status(200).json({
      success: true,
      message: 'Dashboard statistics retrieved successfully.',
      data,
      errors: null
    });
  } catch (err) { next(err); }
};

const getManagerActivityReport = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;

    const managers = await req.User.find({ role: 'Manager' })
      .populate('departmentId', 'name')
      .select('name email departmentId isActive');

    const report = await Promise.all(
      managers.map(async (m) => {
        const folderCount = await req.Folder.countDocuments({ createdBy: m._id, tenantId, isDeleted: false });
        const fileCount = await req.Document.countDocuments({ uploadedBy: m._id, tenantId, isDeleted: false });

        return {
          id: m._id,
          name: m.name,
          email: m.email,
          department: m.departmentId ? m.departmentId.name : 'Global / Unassigned',
          folderCount,
          fileCount,
          isActive: m.isActive
        };
      })
    );

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (err) { next(err); }
};

module.exports = {
  getDashboardStats,
  getManagerActivityReport
};
