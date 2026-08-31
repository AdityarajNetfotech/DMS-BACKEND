const express = require('express');
const router = express.Router({ mergeParams: true });
const upload = require('../middlewares/upload.middleware');
const { authenticate, authorizeRoles } = require('../shared/auth.middleware');
const { tenantResolver } = require('../shared/middleware/tenant.resolver');
const { managerResolver } = require('../middlewares/manager.resolver');

const dashboardController = require('../controllers/dashboard.controller');
const folderController = require('../controllers/folder.controller');
const documentController = require('../controllers/document.controller');
const trashController = require('../controllers/trash.controller');
const shareController = require('../controllers/share.controller');
const storageController = require('../controllers/storage.controller');
const searchController = require('../controllers/search.controller');
const recentController = require('../controllers/recent.controller');
const archiveController = require('../controllers/archive.controller');
const aiController = require('../controllers/ai.controller');

// Resolve tenant and enforce authorization for all routes
router.use(tenantResolver);

// PUBLIC Endpoints for shared link resolutions (no auth token required to preview/download shared files!)
router.get('/shares/resolve/:token', managerResolver, shareController.resolveShareLink);
router.get('/shares/download/:token', managerResolver, shareController.downloadSharedFile);

// Special Upload Route allowing both Manager, Admin, and Viewer roles
router.post(
  '/documents/upload',
  authenticate,
  authorizeRoles('Manager', 'Tenant Admin', 'Viewer'),
  managerResolver,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (req.isAccessLocked) {
        return res.status(403).json({
          success: false,
          message: 'Your subscription has expired. Please upgrade or renew your plan to continue uploading files.'
        });
      }
      const userRole = req.user.role;
      const userId = req.user.userId;
      const tenantId = req.user.companySlug;
      const { folderId } = req.body;

      // Allow Tenant Admin to upload anywhere
      if (userRole === 'Tenant Admin') {
        return next();
      }

      // If folderId is not provided, only Manager can upload (Viewer cannot upload to root)
      if (!folderId) {
        if (userRole === 'Manager') {
          return next();
        }
        return res.status(403).json({ success: false, message: 'Viewers can only upload to shared folders. Please provide a folder ID.' });
      }

      const Folder = req.Folder;
      const Share = req.Share;

      // Helper to check recursively if user has upload permission
      const checkUploadPermission = async (targetId) => {
        let currentId = targetId;
        while (currentId) {
          const folder = await Folder.findOne({ _id: currentId, tenantId, isDeleted: false });
          if (!folder) return false;
          
          if (folder.createdBy?.toString() === userId || folder.createdBy?._id?.toString() === userId) {
            return true;
          }
          
          const share = await Share.findOne({
            tenantId,
            folderId: currentId,
            sharingType: 'Internal',
            $or: [
              { sharedWithViewers: new (require('mongoose').Types.ObjectId)(userId) },
              { sharedWithViewers: { $exists: true, $size: 0 } },
              { sharedWithViewers: { $exists: false } }
            ],
            'permissions.uploadAllowed': true
          });
          if (share) return true;
          
          currentId = folder.parentFolder;
        }
        return false;
      };

      const hasPermission = await checkUploadPermission(folderId);
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: 'You do not have permission to upload files to this folder.' });
      }

      next();
    } catch (err) {
      next(err);
    }
  },
  documentController.uploadDocument
);

// Enforce login and Manager role for everything else
router.use(authenticate, authorizeRoles('Manager', 'Tenant Admin'), managerResolver);

// Dashboard
router.get('/dashboard', dashboardController.getDashboardStats);
router.get('/activity-report', dashboardController.getManagerActivityReport);

// Recent Items Route
router.get('/recent', recentController.getRecentItems);

// Folders
router.post('/folders', upload.array('files', 15), folderController.createFolder);
router.get('/folders/tree', folderController.getFolderTree);
router.get('/folders/:id', folderController.getFolderDetails);
router.put('/folders/:id', folderController.updateFolder);
router.delete('/folders/:id', folderController.deleteFolder);
router.post('/folders/:id/move', folderController.moveFolder);
router.get('/folders/:id/zip', folderController.downloadFolderZip);

router.post('/folders/:id/lock', folderController.lockFolder);
router.post('/folders/:id/archive', folderController.archiveFolder);
router.post('/folders/:id/favorite', folderController.favoriteFolder);

router.post('/folders/:id/summarize', aiController.summarizeFolder);

// Documents
router.post('/documents/:id/summarize', aiController.summarizeDocument);
router.get('/documents/:id', documentController.getDocumentDetails);
router.get('/documents/:id/download', documentController.downloadDocument);
router.get('/documents/:id/preview', documentController.previewDocument);
router.put('/documents/:id', documentController.updateDocument);
router.post('/documents/:id/lock', documentController.lockDocument);
router.post('/documents/:id/archive', documentController.archiveDocument);
router.post('/documents/:id/favorite', documentController.favoriteDocument);
router.delete('/documents/:id', documentController.softDeleteDocument);
router.post('/documents/:id/copy', documentController.copyDocument);
router.post('/documents/:id/move', documentController.moveDocument);
router.get('/documents/:id/versions', documentController.getVersionHistory);
router.post('/documents/:id/versions/:versionId/restore', documentController.restoreDocumentVersion);
router.post('/documents/:id/convert', documentController.convertDocument);

// Trash
router.get('/trash', trashController.getTrashList);
router.post('/trash/:id/restore', trashController.restoreResource);
router.delete('/trash/:id/permanent', trashController.permanentlyDeleteResource);
router.delete('/trash/empty', trashController.emptyTrash);

// Sharing
router.get('/shares', shareController.getSharedItems);
router.post('/shares/create/folder/:folderId', shareController.createFolderShareLink);
router.post('/shares/create/:documentId', shareController.createShareLink);

// Storage
router.get('/storage/summary', storageController.getStorageSummary);
router.get('/storage/folder/:folderId', storageController.getFolderSize);

// Search
router.get('/search', searchController.globalSearch);
router.get('/search/document-ids', searchController.listDocumentIds);

// Archive
router.get('/archive', archiveController.getArchivedItems);
router.post('/archive/verify', archiveController.verifyArchivePassword);

module.exports = router;
