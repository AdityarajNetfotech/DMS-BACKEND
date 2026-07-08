const folderSchema = require('../models/folder.model');
const documentSchema = require('../models/document.model');
const favoriteSchema = require('../models/favorite.model');
const notificationSchema = require('../models/notification.model');
const activityLogSchema = require('../models/activityLog.model');
const trashSchema = require('../models/trash.model');
const shareSchema = require('../models/share.model');
const versionSchema = require('../models/version.model');
const storageSchema = require('../models/storage.model');

const managerResolver = (req, res, next) => {
  if (!req.tenantDb) {
    return res.status(500).json({ success: false, message: 'Database connection not initialized' });
  }

  try {
    // Compile models dynamically on the current tenant connection if not already present
    if (!req.tenantDb.models.Folder) req.tenantDb.model('Folder', folderSchema);
    if (!req.tenantDb.models.Document) req.tenantDb.model('Document', documentSchema);
    if (!req.tenantDb.models.Favorite) req.tenantDb.model('Favorite', favoriteSchema);
    if (!req.tenantDb.models.Notification) req.tenantDb.model('Notification', notificationSchema);
    if (!req.tenantDb.models.ActivityLog) req.tenantDb.model('ActivityLog', activityLogSchema);
    if (!req.tenantDb.models.Trash) req.tenantDb.model('Trash', trashSchema);
    if (!req.tenantDb.models.Share) req.tenantDb.model('Share', shareSchema);
    if (!req.tenantDb.models.Version) req.tenantDb.model('Version', versionSchema);
    if (!req.tenantDb.models.Storage) req.tenantDb.model('Storage', storageSchema);

    const departmentSchema = require('../shared/models/department.model');
    if (!req.tenantDb.models.Department) req.tenantDb.model('Department', departmentSchema);

    // Bind models to request context for easy repository access
    req.Folder = req.tenantDb.model('Folder');
    req.Document = req.tenantDb.model('Document');
    req.Favorite = req.tenantDb.model('Favorite');
    req.Notification = req.tenantDb.model('Notification');
    req.ActivityLog = req.tenantDb.model('ActivityLog');
    req.Trash = req.tenantDb.model('Trash');
    req.Share = req.tenantDb.model('Share');
    req.Version = req.tenantDb.model('Version');
    req.Storage = req.tenantDb.model('Storage');
    req.Department = req.tenantDb.model('Department');

    next();
  } catch (error) {
    console.error('Manager Model Registration Error:', error);
    res.status(500).json({ success: false, message: 'Error registering manager models' });
  }
};

module.exports = { managerResolver };
