const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate, authorizeRoles } = require('../shared/auth.middleware');
const { tenantResolver } = require('../shared/middleware/tenant.resolver');
const { viewerResolver } = require('../middlewares/viewer.resolver');
const viewerController = require('../controllers/viewer.controller');

// Resolve tenant DB first
router.use(tenantResolver);

// PUBLIC endpoints for resolving password protected share links
router.get('/shares/resolve/:token', viewerResolver, viewerController.resolveShareLink);
router.get('/shares/download/:token', viewerResolver, viewerController.downloadSharedFile);

// Secure Viewer/Manager read-only access endpoints
router.use(authenticate, authorizeRoles('Viewer', 'Manager'), viewerResolver);

// Dashboard
router.get('/dashboard', viewerController.getDashboardStats);

// Folders
router.get('/folders/tree', viewerController.getFolderTree);
router.get('/folders/:id', viewerController.getFolderDetails);

// Documents
router.get('/documents', viewerController.getAllDocuments);
router.get('/documents/:id', viewerController.getDocumentDetails);
router.get('/documents/:id/download', viewerController.downloadDocument);
router.get('/documents/:id/preview', viewerController.previewDocument);

// Search
router.get('/search', viewerController.globalSearch);

// Favorites
router.get('/favorites', viewerController.getFavorites);
router.post('/favorites/:documentId', viewerController.toggleFavorite);

// Shares
router.get('/shares/shared-with-me', viewerController.getSharedWithMe);

module.exports = router;
