const express = require('express');
const router = express.Router({ mergeParams: true });
const departmentController = require('../controllers/department.controller');
const { authenticate, authorizeRoles } = require('../shared/auth.middleware');
const { tenantResolver } = require('../shared/middleware/tenant.resolver');

// All routes require Tenant Admin access
router.use(tenantResolver);
router.use(authenticate);
router.use(authorizeRoles('Tenant Admin'));

router.post('/', departmentController.createDepartment);
router.get('/', departmentController.getDepartments);
router.put('/:id', departmentController.updateDepartment);
router.delete('/:id', departmentController.deleteDepartment);

module.exports = router;
