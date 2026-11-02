const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenant.controller');
const { authenticate, authorizeRoles } = require('../shared/auth.middleware');

// Subscription routes (Accessible for payment checkout & status checks)
router.post('/subscription/order', tenantController.createSubscriptionOrder);
router.post('/subscription/verify', tenantController.verifySubscriptionPayment);
router.get('/subscription/status/:companySlug', tenantController.getSubscriptionStatus);

// Cross-platform automatic sync from VerifyChain
router.post('/sync-from-verifychain', tenantController.syncFromVerifyChain);

// SuperAdmin protected tenant management routes
router.use(authenticate, authorizeRoles('SuperAdmin'));

router.post('/', tenantController.createTenant);
router.get('/', tenantController.getAllTenants);
router.get('/:id', tenantController.getTenantById);
router.put('/:id', tenantController.updateTenant);
router.delete('/:id', tenantController.deleteTenant);

module.exports = router;