const Tenant = require('../shared/models/tenant.model');
const { getTenantConnection } = require('../shared/tenant.db');
const userSchema = require('../shared/models/user.model');
const crypto = require('crypto');

const createTenant = async (req, res, next) => {
  try {
    const {
      companyName,
      legalBusinessName,
      companyCode,
      registrationNumber,
      gstNumber,
      panNumber,
      industryType,
      companySize,
      website,
      logo,
      description,
      officialEmail,
      adminEmail,
      adminName,
      adminMobile,
      adminDesignation,
      adminPassword,
      phone,
      alternatePhone,
      address,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      defaultLanguage,
      timezone,
    } = req.body;

    // Validate required fields
    if (!companyName || !companyCode || !adminEmail) {
      return res.status(400).json({
        success: false,
        message: 'companyName, companyCode, and adminEmail are required',
      });
    }

    const companySlug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check for existing tenant by slug or code
    const existing = await Tenant.findOne({
      $or: [{ companySlug }, { companyCode: companyCode.toUpperCase() }],
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A tenant with this company name or code already exists',
      });
    }

    // Build tenant database URI
    const basePath = process.env.MONGO_MASTER_URI.substring(
      0,
      process.env.MONGO_MASTER_URI.lastIndexOf('/')
    );
    const qsIndex = process.env.MONGO_MASTER_URI.indexOf('?');
    const queryParams =
      qsIndex !== -1 ? process.env.MONGO_MASTER_URI.substring(qsIndex) : '';
    const tenantDbUri = `${basePath}/tenant_${companySlug.replace(/-/g, '_')}${queryParams}`;

    // Create tenant record in master DB
    const tenant = new Tenant({
      companyName,
      legalBusinessName: legalBusinessName || '',
      companyCode: companyCode.toUpperCase(),
      registrationNumber: registrationNumber || '',
      gstNumber: gstNumber || '',
      panNumber: panNumber || '',
      industryType: industryType || '',
      companySize: companySize || '',
      website: website || '',
      logo: logo || '',
      description: description || '',
      officialEmail: officialEmail || '',
      companySlug,
      adminEmail,
      adminName: adminName || '',
      adminMobile: adminMobile || '',
      adminDesignation: adminDesignation || '',
      phone: phone || '',
      alternatePhone: alternatePhone || '',
      address: address || '',
      addressLine2: addressLine2 || '',
      city: city || '',
      state: state || '',
      postalCode: postalCode || '',
      country: country || '',
      defaultLanguage: defaultLanguage || 'English',
      timezone: timezone || 'IST (UTC+5:30)',
      dbUri: tenantDbUri,
    });
    await tenant.save();

    // Create admin user in tenant's own database
    const tenantDb = await getTenantConnection(companySlug, tenantDbUri);
    const User = tenantDb.model('User', userSchema);

    const tempPassword = adminPassword || crypto.randomBytes(8).toString('hex');
    const admin = new User({
      name: adminName || companyName + ' Admin',
      email: adminEmail,
      password: tempPassword,
      role: 'Tenant Admin',
    });
    await admin.save();

    // Direct REST API Call to Email Service
    fetch(process.env.EMAIL_SERVICE_URL + '/api/email/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        role: 'Tenant Admin',
        companyName,
        companySlug,
        tempPassword,
        loginUrl: `http://localhost:5173/${companySlug}/login`,
      }),
    }).catch((err) =>
      console.error('Failed to call email service:', err.message)
    );

    res.status(201).json({
      success: true,
      tenant,
      message: 'Tenant created and email requested',
    });
  } catch (err) {
    next(err);
  }
};

const getAllTenants = async (req, res, next) => {
  try {
    const tenants = await Tenant.find()
      .select('-dbUri')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tenants.length,
      tenants,
    });
  } catch (err) {
    next(err);
  }
};

const getTenantById = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).select('-dbUri');
    if (!tenant) {
      return res
        .status(404)
        .json({ success: false, message: 'Tenant not found' });
    }
    res.status(200).json({ success: true, tenant });
  } catch (err) {
    next(err);
  }
};

const updateTenant = async (req, res, next) => {
  try {
    const allowedUpdates = [
      'companyName',
      'companyCode',
      'legalBusinessName',
      'registrationNumber',
      'gstNumber',
      'panNumber',
      'industryType',
      'companySize',
      'website',
      'logo',
      'description',
      'phone',
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'defaultLanguage',
      'timezone',
    ];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const tenant = await Tenant.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select('-dbUri');

    if (!tenant) {
      return res
        .status(404)
        .json({ success: false, message: 'Tenant not found' });
    }

    res.status(200).json({ success: true, tenant });
  } catch (err) {
    next(err);
  }
};

const deleteTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findByIdAndDelete(req.params.id);
    if (!tenant) {
      return res
        .status(404)
        .json({ success: false, message: 'Tenant not found' });
    }
    res
      .status(200)
      .json({ success: true, message: 'Tenant deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
};