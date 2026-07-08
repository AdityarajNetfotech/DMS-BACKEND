const Tenant = require('../models/tenant.model');
const { getTenantConnection } = require('../tenant.db');
const userSchema = require('../models/user.model');

const tenantResolver = async (req, res, next) => {
  const { companySlug } = req.params;

  console.log(`[tenantResolver] entered for slug: ${companySlug}, path: ${req.path}`);
  if (!companySlug) {
    console.log(`[tenantResolver] missing slug`);
    return res.status(400).json({ success: false, message: 'Company slug is required' });
  }

  try {
    const tenant = await Tenant.findOne({ companySlug, isActive: true });
    
    if (!tenant) {
      console.log(`[tenantResolver] tenant not found for slug: ${companySlug}`);
      return res.status(404).json({ success: false, message: 'Tenant not found or inactive' });
    }

    const tenantDbConnection = await getTenantConnection(companySlug, tenant.dbUri);

    // Register models on this connection if they aren't already
    if (!tenantDbConnection.models.User) {
      tenantDbConnection.model('User', userSchema);
    }
    const departmentSchema = require('../models/department.model');
    if (!tenantDbConnection.models.Department) {
      tenantDbConnection.model('Department', departmentSchema);
    }

    // Attach to request object
    req.tenant = tenant;
    req.tenantDb = tenantDbConnection;
    req.User = tenantDbConnection.model('User');
    req.Department = tenantDbConnection.model('Department');
    
    console.log(`[tenantResolver] successfully resolved tenant: ${companySlug}, calling next()`);
    next();
  } catch (error) {
    console.error('Tenant Resolver Error:', error);
    res.status(500).json({ success: false, message: 'Error resolving tenant database' });
  }
};

module.exports = { tenantResolver };
