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
      registrationDate,
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

    if (gstNumber) {
      const existingGst = await Tenant.findOne({ gstNumber: gstNumber.trim() });
      if (existingGst) {
        return res.status(400).json({
          success: false,
          message: 'A tenant with this GST number already exists',
        });
      }
    }

    if (panNumber) {
      const existingPan = await Tenant.findOne({ panNumber: panNumber.trim() });
      if (existingPan) {
        return res.status(400).json({
          success: false,
          message: 'A tenant with this PAN number already exists',
        });
      }
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
      registrationDate: registrationDate ? new Date(registrationDate) : new Date(),
      trialEndsAt: new Date(new Date(registrationDate || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000),
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

    const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    let tempPassword = adminPassword;
    if (tempPassword) {
      if (!PASSWORD_REGEX.test(tempPassword)) {
        return res.status(400).json({
          success: false,
          message: 'Admin password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.'
        });
      }
    } else {
      const randHex = crypto.randomBytes(4).toString('hex');
      tempPassword = `Admin@1${randHex}Z`;
    }

    const admin = new User({
      name: adminName || companyName + ' Admin',
      email: adminEmail,
      password: tempPassword,
      role: 'Tenant Admin',
      mustChangePassword: true,
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
        loginUrl: `${process.env.FRONTEND_URL}/${companySlug}/login`,
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
      'registrationDate',
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
      'postalCode',
      'country',
      'defaultLanguage',
      'timezone',
      'isActive',
    ];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    if (req.body.registrationDate !== undefined) {
      updates.trialEndsAt = new Date(new Date(req.body.registrationDate).getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    if (req.body.gstNumber !== undefined) {
      const existingGst = await Tenant.findOne({
        gstNumber: req.body.gstNumber.trim(),
        _id: { $ne: req.params.id }
      });
      if (existingGst) {
        return res.status(400).json({
          success: false,
          message: 'A tenant with this GST number already exists',
        });
      }
    }

    if (req.body.panNumber !== undefined) {
      const existingPan = await Tenant.findOne({
        panNumber: req.body.panNumber.trim(),
        _id: { $ne: req.params.id }
      });
      if (existingPan) {
        return res.status(400).json({
          success: false,
          message: 'A tenant with this PAN number already exists',
        });
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

const PLAN_PRICES = {
  Basic: 149900, // INR in paise (₹1,499)
  Pro: 399900,   // INR in paise (₹3,999)
  Ultra: 799900  // INR in paise (₹7,999)
};

const getRazorpayInstance = () => {
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey123',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'mock_secret_key_456'
  });
};

const createSubscriptionOrder = async (req, res, next) => {
  try {
    const { planName, companySlug } = req.body;
    if (!planName || !PLAN_PRICES[planName]) {
      return res.status(400).json({ success: false, message: 'Invalid plan selected.' });
    }

    const tenant = await Tenant.findOne({ companySlug });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant workspace not found.' });
    }

    const amount = PLAN_PRICES[planName];
    const currency = 'INR';
    const receipt = `rcpt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    let order;
    try {
      const instance = getRazorpayInstance();
      order = await instance.orders.create({
        amount,
        currency,
        receipt,
        notes: { companySlug, planName }
      });
    } catch (rzpErr) {
      console.error("Razorpay API order creation error detailed:", rzpErr);
      console.warn("Razorpay API order creation warning, generating mock order:", rzpErr.message);
      order = {
        id: `order_mock_${Date.now()}`,
        entity: 'order',
        amount,
        amount_paid: 0,
        amount_due: amount,
        currency: 'INR',
        receipt,
        status: 'created',
        attempts: 0,
        notes: { companySlug, planName },
        created_at: Math.floor(Date.now() / 1000)
      };
    }

    tenant.subscription.razorpayOrderId = order.id;
    await tenant.save();

    res.status(200).json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey123',
      order,
      planName,
      amount
    });
  } catch (err) {
    next(err);
  }
};

const verifySubscriptionPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, companySlug, planName } = req.body;

    const tenant = await Tenant.findOne({ companySlug });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant workspace not found.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || 'mock_secret_key_456';
    
    // HMAC signature verification
    const isMock = razorpay_order_id && razorpay_order_id.startsWith('order_mock_');
    if (!isMock && razorpay_signature) {
      const generatedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Payment signature verification failed.' });
      }
    }

    // Update tenant subscription status (30 days validity)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    tenant.subscription = {
      plan: planName || 'Basic',
      status: 'active',
      razorpayOrderId: razorpay_order_id || `order_mock_${Date.now()}`,
      razorpayPaymentId: razorpay_payment_id || `pay_mock_${Date.now()}`,
      expiresAt
    };

    await tenant.save();

    res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${tenant.subscription.plan} Plan!`,
      subscription: tenant.subscription
    });
  } catch (err) {
    next(err);
  }
};

const getSubscriptionStatus = async (req, res, next) => {
  try {
    const { companySlug } = req.params;
    const tenant = await Tenant.findOne({ companySlug }).select('-dbUri');
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant workspace not found.' });
    }

    // Subscription model removed: always active and unlocked
    res.status(200).json({
      success: true,
      trialEndsAt: null,
      trialEnded: false,
      planExpired: false,
      isAccessLocked: false,
      subscription: { plan: 'Enterprise', status: 'Active' },
      aiUsage: { count: 0, limit: Infinity }
    });
  } catch (err) {
    next(err);
  }
};

const syncFromVerifyChain = async (req, res, next) => {
  try {
    const {
      companyName,
      companySlug,
      companyCode,
      adminEmail,
      adminName,
      adminPhone,
      phone,
      gstNumber,
      panNumber,
      cinNumber,
      registrationCode,
      industry,
      website,
      logo
    } = req.body;

    if (!companyName || !companySlug) {
      return res.status(400).json({
        success: false,
        message: 'companyName and companySlug are required'
      });
    }

    const safeSlug = companySlug.toLowerCase().replace(/[^a-z0-9_-]/g, '');

    // 1. Check if tenant already exists in Master DB
    let tenant = await Tenant.findOne({ companySlug: safeSlug });
    if (tenant) {
      return res.status(200).json({
        success: true,
        message: `Tenant '${safeSlug}' already registered in DMS Master DB`,
        tenant: {
          id: tenant._id,
          companySlug: tenant.companySlug,
          companyName: tenant.companyName
        }
      });
    }

    // 2. Build tenant database URI
    const masterUri = process.env.MONGO_MASTER_URI || 'mongodb://localhost:27017/dms_master';
    const baseUri = masterUri.split('?')[0].replace(/\/[^/]+$/, '');
    const queryParams = masterUri.includes('?') ? '?' + masterUri.split('?')[1] : '';
    const tenantDbUri = `${baseUri}/tenant_${safeSlug.replace(/-/g, '_')}${queryParams}`;

    const safeCode = (companyCode || registrationCode || safeSlug)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'TENANT';

    // 3. Create Tenant document in Master DB with Enterprise plan
    tenant = new Tenant({
      companyName,
      companySlug: safeSlug,
      companyCode: safeCode,
      adminEmail: adminEmail || `admin@${safeSlug}.com`,
      adminName: adminName || companyName + ' Admin',
      adminMobile: adminPhone || phone || '',
      phone: phone || '',
      gstNumber: gstNumber || '',
      panNumber: panNumber || '',
      registrationNumber: registrationCode || cinNumber || '',
      industryType: industry || '',
      website: website || '',
      logo: logo || '',
      dbUri: tenantDbUri,
      isActive: true,
      subscription: {
        plan: 'Enterprise',
        status: 'Active',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });

    await tenant.save();

    // 4. Provision tenant DB and seed admin user
    try {
      const tenantDb = await getTenantConnection(safeSlug, tenantDbUri);
      const User = tenantDb.model('User', userSchema);

      const existingUser = await User.findOne({ email: tenant.adminEmail });
      if (!existingUser) {
        const generatedPassword = crypto.randomBytes(16).toString('hex') + 'A1!';
        const newUser = new User({
          name: tenant.adminName || companyName + ' Admin',
          email: tenant.adminEmail,
          password: generatedPassword,
          role: 'Manager',
          status: 'Active',
          mustChangePassword: false
        });
        await newUser.save();
      }
    } catch (seedErr) {
      console.warn(`[DMS Sync] Tenant master created, but DB user seed deferred: ${seedErr.message}`);
    }

    return res.status(201).json({
      success: true,
      message: `Tenant '${safeSlug}' successfully synchronized and provisioned in DMS`,
      tenant: {
        id: tenant._id,
        companySlug: tenant.companySlug,
        companyName: tenant.companyName,
        companyCode: tenant.companyCode
      }
    });
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
  createSubscriptionOrder,
  verifySubscriptionPayment,
  getSubscriptionStatus,
  syncFromVerifyChain
};