const fs = require('fs');
const path = require('path');

const rootDir = __dirname;

const writeFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.trim());
};

// ----------------------------------------------------
// Email Service (REST API)
// ----------------------------------------------------
writeFile(path.join(rootDir, 'email-service/src/server.js'), `
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { errorHandler } = require('./shared/error.handler');

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});

app.post('/api/email/welcome', async (req, res, next) => {
  try {
    const { email, role, companyName, companySlug, tempPassword, loginUrl } = req.body;
    
    console.log('Sending email to:', email);

    const html = \`
      <h1>Welcome to \${companyName}</h1>
      <p>Role: \${role}</p>
      <p>Login URL: <a href="\${loginUrl}">\${loginUrl}</a></p>
      <p>Temporary Password: \${tempPassword}</p>
    \`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.FROM_EMAIL,
      to: email,
      subject: 'Welcome to ' + companyName,
      html
    });

    res.status(200).json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Email send failed:', err);
    next(err);
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log('Email Service running on port ' + PORT));
`);

// ----------------------------------------------------
// Tenant Service (Direct REST API Call)
// ----------------------------------------------------
writeFile(path.join(rootDir, 'tenant-service/src/controllers/tenant.controller.js'), `
const Tenant = require('../shared/models/tenant.model');
const { getTenantConnection } = require('../shared/tenant.db');
const userSchema = require('../shared/models/user.model');
const crypto = require('crypto');

const createTenant = async (req, res, next) => {
  try {
    const { companyName, adminEmail } = req.body;
    const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const existing = await Tenant.findOne({ companySlug });
    if (existing) return res.status(400).json({ success: false, message: 'Tenant exists' });

    const basePath = process.env.MONGO_MASTER_URI.substring(0, process.env.MONGO_MASTER_URI.lastIndexOf('/'));
    const qsIndex = process.env.MONGO_MASTER_URI.indexOf('?');
    const queryParams = qsIndex !== -1 ? process.env.MONGO_MASTER_URI.substring(qsIndex) : '';
    const tenantDbUri = \`\${basePath}/tenant_\${companySlug.replace(/-/g, '_')}\${queryParams}\`;

    const tenant = new Tenant({ companyName, companySlug, dbUri: tenantDbUri });
    await tenant.save();

    const tenantDb = await getTenantConnection(companySlug, tenantDbUri);
    const User = tenantDb.model('User', userSchema);

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const admin = new User({ email: adminEmail, password: tempPassword, role: 'Tenant Admin' });
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
        loginUrl: \`http://localhost:5173/\${companySlug}/login\`
      })
    }).catch(err => console.error('Failed to call email service:', err.message));

    res.status(201).json({ success: true, tenant, message: 'Tenant created and email requested' });
  } catch (err) { next(err); }
};

module.exports = { createTenant };
`);

// ----------------------------------------------------
// User Service (Direct REST API Call)
// ----------------------------------------------------
writeFile(path.join(rootDir, 'user-service/src/server.js'), `
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { errorHandler } = require('./shared/error.handler');
const { authenticate, authorizeRoles } = require('./shared/auth.middleware');
const { tenantResolver } = require('./shared/middleware/tenant.resolver');

const app = express();
app.use(cors());
app.use(express.json());

const router = express.Router({ mergeParams: true });

router.use(tenantResolver);
router.use(authenticate);

// Get Users
router.get('/', authorizeRoles('Tenant Admin', 'Manager'), async (req, res, next) => {
  try {
    const users = await req.User.find().select('-password');
    res.status(200).json({ success: true, data: users });
  } catch (err) { next(err); }
});

// Create User
router.post('/', authorizeRoles('Tenant Admin'), async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!['Manager', 'Viewer'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
    
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const user = new req.User({ email, role, password: tempPassword });
    await user.save();

    // Direct REST API Call to Email Service
    fetch(process.env.EMAIL_SERVICE_URL + '/api/email/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        role,
        companyName: req.tenant.companyName,
        companySlug: req.tenant.companySlug,
        tempPassword,
        loginUrl: \`http://localhost:5173/\${req.tenant.companySlug}/login\`
      })
    }).catch(err => console.error('Failed to call email service:', err.message));

    res.status(201).json({ success: true, message: 'User created' });
  } catch (err) { next(err); }
});

app.use('/api/:companySlug/users', router);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('User Service connected to Master DB');
    const PORT = process.env.PORT || 3004;
    app.listen(PORT, () => console.log('User Service running on port ' + PORT));
  })
  .catch(err => console.error(err));
`);

console.log('Successfully replaced RabbitMQ with Direct REST API Calls!');
