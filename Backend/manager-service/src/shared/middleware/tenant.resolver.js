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
    let tenant = await Tenant.findOne({ companySlug, isActive: true });
    
    if (!tenant) {
      console.log(`[tenantResolver] tenant not found for slug: ${companySlug}, auto-provisioning master tenant record`);
      const mongoUri = process.env.MONGO_MASTER_URI || 'mongodb://localhost:27017/dms_master';
      const baseUri = mongoUri.split('?')[0].replace(/\/[^/]+$/, '');
      const queryParams = mongoUri.includes('?') ? '?' + mongoUri.split('?')[1] : '';
      const safeSlug = companySlug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const tenantDbUri = `${baseUri}/tenant_${safeSlug.replace(/-/g, '_')}${queryParams}`;

      tenant = new Tenant({
        companyName: companySlug.replace(/[-_]/g, ' ').toUpperCase(),
        companySlug: companySlug,
        companyCode: companySlug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TENANT',
        adminEmail: `admin@${safeSlug}.com`,
        adminName: `${companySlug.replace(/[-_]/g, ' ')} Admin`,
        dbUri: tenantDbUri,
        isActive: true,
        subscription: { plan: 'Enterprise', status: 'Active' }
      });
      try {
        await tenant.save();
      } catch (saveErr) {
        tenant = await Tenant.findOne({ companySlug });
        if (!tenant) {
          console.error(`[tenantResolver] failed to auto-provision tenant: ${companySlug}`, saveErr);
          return res.status(404).json({ success: false, message: 'Tenant not found and auto-provisioning failed' });
        }
      }
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
    const activityLogSchema = require('../models/activityLog.model');
    if (!tenantDbConnection.models.ActivityLog) {
      tenantDbConnection.model('ActivityLog', activityLogSchema);
    }

    // Attach to request object
    req.tenant = tenant;
    req.tenantDb = tenantDbConnection;
    req.User = tenantDbConnection.model('User');
    req.Department = tenantDbConnection.model('Department');
    req.ActivityLog = tenantDbConnection.model('ActivityLog');

    // Compute isAccessLocked based on Trial expiration or plan expiration
    const regDate = tenant.registrationDate || tenant.createdAt;
    const trialEndsAt = regDate ? new Date(new Date(regDate).getTime() + 7 * 24 * 60 * 60 * 1000) : tenant.trialEndsAt;

    const now = new Date();
    const trialEnded = trialEndsAt && new Date(trialEndsAt) < now;
    const planExpired = tenant.subscription?.expiresAt && new Date(tenant.subscription.expiresAt) < now;

    // Subscription model removed per user specification: always unlocked
    let isAccessLocked = false;
    req.isAccessLocked = false;
    
    console.log(`[tenantResolver] successfully resolved tenant: ${companySlug}, isAccessLocked: ${isAccessLocked}, calling next()`);
    next();
  } catch (error) {
    console.error('Tenant Resolver Error:', error);
    res.status(500).json({ success: false, message: 'Error resolving tenant database' });
  }
};

module.exports = { tenantResolver };
