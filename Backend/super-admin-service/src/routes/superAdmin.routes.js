const express = require('express');
const router = express.Router();
const superAdminController = require('../controllers/superAdmin.controller');

const { authenticate, authorizeRoles } = require('../shared/auth.middleware');

router.post('/register', superAdminController.register);
router.post('/login', superAdminController.login);
router.post('/forgot-password', superAdminController.forgotPassword);
router.post('/verify-otp', superAdminController.verifyOtp);
router.post('/reset-password', superAdminController.resetPassword);
router.post('/enquiry', superAdminController.createEnquiry); // Public

router.get('/enquiries', authenticate, authorizeRoles('SuperAdmin'), superAdminController.getEnquiries);
router.post('/enquiries/reply', authenticate, authorizeRoles('SuperAdmin'), superAdminController.replyEnquiry);
router.get('/dashboard-stats', authenticate, authorizeRoles('SuperAdmin'), superAdminController.getDashboardStats);

module.exports = router;