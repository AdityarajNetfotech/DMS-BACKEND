const folderSchema = require('../models/folder.model');
const documentSchema = require('../models/document.model');
const favoriteSchema = require('../models/favorite.model');
const activityLogSchema = require('../models/activityLog.model');
const versionSchema = require('../models/version.model');
const shareSchema = require('../models/share.model');

const viewerResolver = (req, res, next) => {
  if (!req.tenantDb) {
    return res.status(500).json({ success: false, message: 'Database connection not initialized' });
  }

  try {
    if (!req.tenantDb.models.Folder) req.tenantDb.model('Folder', folderSchema);
    if (!req.tenantDb.models.Document) req.tenantDb.model('Document', documentSchema);
    if (!req.tenantDb.models.Favorite) req.tenantDb.model('Favorite', favoriteSchema);
    if (!req.tenantDb.models.ActivityLog) req.tenantDb.model('ActivityLog', activityLogSchema);
    if (!req.tenantDb.models.Version) req.tenantDb.model('Version', versionSchema);
    if (!req.tenantDb.models.Share) req.tenantDb.model('Share', shareSchema);

    req.Folder = req.tenantDb.model('Folder');
    req.Document = req.tenantDb.model('Document');
    req.Favorite = req.tenantDb.model('Favorite');
    req.ActivityLog = req.tenantDb.model('ActivityLog');
    req.Version = req.tenantDb.model('Version');
    req.Share = req.tenantDb.model('Share');

    next();
  } catch (error) {
    console.error('Viewer Model Registration Error:', error);
    res.status(500).json({ success: false, message: 'Error registering viewer database models' });
  }
};

module.exports = { viewerResolver };
