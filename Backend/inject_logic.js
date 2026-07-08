const fs = require('fs');
const path = require('path');

const rootDir = __dirname;

const writeFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.trim());
};

// ----------------------------------------------------
// Super Admin Service
// ----------------------------------------------------
writeFile(path.join(rootDir, 'super-admin-service/src/server.js'), `
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { errorHandler } = require('./shared/error.handler');
const superAdminRoutes = require('./routes/superAdmin.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', superAdminRoutes);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('Super Admin Service connected to Master DB');
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => console.log('Super Admin Service running on port ' + PORT));
  })
  .catch(err => console.error(err));
`);

writeFile(path.join(rootDir, 'super-admin-service/src/routes/superAdmin.routes.js'), `
const express = require('express');
const router = express.Router();
const superAdminController = require('../controllers/superAdmin.controller');

router.post('/register', superAdminController.register);
router.post('/login', superAdminController.login);

module.exports = router;
`);

writeFile(path.join(rootDir, 'super-admin-service/src/controllers/superAdmin.controller.js'), `
const SuperAdmin = require('../models/superAdmin.model');
const { generateTokens } = require('../shared/jwt.utils');

const register = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const existing = await SuperAdmin.findOne();
    if (existing) return res.status(400).json({ success: false, message: 'Super Admin already exists' });

    const superAdmin = new SuperAdmin({ email, password });
    await superAdmin.save();
    res.status(201).json({ success: true, message: 'Super Admin registered' });
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const superAdmin = await SuperAdmin.findOne({ email });
    if (!superAdmin || !(await superAdmin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    superAdmin.role = 'SuperAdmin';
    const tokens = generateTokens(superAdmin);
    res.status(200).json({ success: true, tokens });
  } catch (err) { next(err); }
};

module.exports = { register, login };
`);

// ----------------------------------------------------
// Tenant Service
// ----------------------------------------------------
writeFile(path.join(rootDir, 'tenant-service/src/server.js'), `
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { errorHandler } = require('./shared/error.handler');
const tenantRoutes = require('./routes/tenant.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', tenantRoutes);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('Tenant Service connected to Master DB');
    const PORT = process.env.PORT || 3003;
    app.listen(PORT, () => console.log('Tenant Service running on port ' + PORT));
  })
  .catch(err => console.error(err));
`);

writeFile(path.join(rootDir, 'tenant-service/src/routes/tenant.routes.js'), `
const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenant.controller');
const { authenticate, authorizeRoles } = require('../shared/auth.middleware');

router.use(authenticate, authorizeRoles('SuperAdmin'));
router.post('/', tenantController.createTenant);

module.exports = router;
`);

writeFile(path.join(rootDir, 'tenant-service/src/controllers/tenant.controller.js'), `
const Tenant = require('../shared/models/tenant.model');
const { getTenantConnection } = require('../shared/tenant.db');
const userSchema = require('../shared/models/user.model');
const crypto = require('crypto');
const amqp = require('amqplib');

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

    // Send RabbitMQ event
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue('email_queue');
    const payload = JSON.stringify({
      email: adminEmail,
      role: 'Tenant Admin',
      companyName,
      companySlug,
      tempPassword,
      loginUrl: \`http://localhost:5173/\${companySlug}/login\`
    });
    channel.sendToQueue('email_queue', Buffer.from(payload));
    setTimeout(() => connection.close(), 500);

    res.status(201).json({ success: true, tenant, message: 'Tenant created and email queued' });
  } catch (err) { next(err); }
};

module.exports = { createTenant };
`);

// ----------------------------------------------------
// Email Service
// ----------------------------------------------------
writeFile(path.join(rootDir, 'email-service/src/server.js'), `
require('dotenv').config();
const amqp = require('amqplib');
const nodemailer = require('nodemailer');

const start = async () => {
  try {
    console.log('Connecting to RabbitMQ:', process.env.RABBITMQ_URL);
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();
    
    await channel.assertQueue('email_queue');
    console.log('Email Service waiting for messages...');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    });

    channel.consume('email_queue', async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());
        console.log('Sending email to:', data.email);

        let html = '';
        let subject = '';

        if (data.action === 'forgot_password') {
          subject = 'Password Reset OTP - ' + data.companyName;
          html = \`
            <h1>Password Reset</h1>
            <p>Your OTP for password reset is: <strong>\${data.otp}</strong></p>
            <p>This OTP will expire in 10 minutes.</p>
          \`;
        } else {
          subject = 'Welcome to ' + data.companyName;
          html = \`
            <h1>Welcome to \${data.companyName}</h1>
            <p>Role: \${data.role}</p>
            <p>Login URL: <a href="\${data.loginUrl}">\${data.loginUrl}</a></p>
            <p>Temporary Password: \${data.tempPassword}</p>
          \`;
        }

        try {
          await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: data.email,
            subject: subject,
            html
          });
          console.log('Email sent successfully');
          channel.ack(msg);
        } catch (err) {
          console.error('Email send failed:', err);
          channel.nack(msg);
        }
      }
    });

  } catch (err) {
    console.error('Email Service Error:', err);
    setTimeout(start, 5000); // Retry
  }
};

start();
`);

// ----------------------------------------------------
// Auth Service (Tenant Login)
// ----------------------------------------------------
writeFile(path.join(rootDir, 'auth-service/src/server.js'), `
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { errorHandler } = require('./shared/error.handler');
const { generateTokens } = require('./shared/jwt.utils');
const { tenantResolver } = require('./shared/middleware/tenant.resolver');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/login', tenantResolver, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await req.User.findOne({ email, isActive: true });
    
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const tokens = generateTokens(user, req.tenant.companySlug);
    res.status(200).json({ success: true, tokens, role: user.role });
  } catch (err) { next(err); }
});

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('Auth Service connected to Master DB');
    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => console.log('Auth Service running on port ' + PORT));
  })
  .catch(err => console.error(err));
`);

// ----------------------------------------------------
// User Service
// ----------------------------------------------------
writeFile(path.join(rootDir, 'user-service/src/server.js'), `
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const amqp = require('amqplib');
const { errorHandler } = require('./shared/error.handler');
const { authenticate, authorizeRoles } = require('./shared/auth.middleware');
const { tenantResolver } = require('./shared/middleware/tenant.resolver');

const app = express();
app.use(cors());
app.use(express.json());

app.use(tenantResolver);
app.use(authenticate);

// Get Users
app.get('/', authorizeRoles('Tenant Admin', 'Manager'), async (req, res, next) => {
  try {
    const users = await req.User.find().select('-password');
    res.status(200).json({ success: true, data: users });
  } catch (err) { next(err); }
});

// Create User
app.post('/', authorizeRoles('Tenant Admin'), async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!['Manager', 'Viewer'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
    
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const user = new req.User({ email, role, password: tempPassword });
    await user.save();

    // Send RabbitMQ event
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue('email_queue');
    const payload = JSON.stringify({
      email,
      role,
      companyName: req.tenant.companyName,
      companySlug: req.tenant.companySlug,
      tempPassword,
      loginUrl: \`http://localhost:5173/\${req.tenant.companySlug}/login\`
    });
    channel.sendToQueue('email_queue', Buffer.from(payload));
    setTimeout(() => connection.close(), 500);

    res.status(201).json({ success: true, message: 'User created' });
  } catch (err) { next(err); }
});

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('User Service connected to Master DB');
    const PORT = process.env.PORT || 3004;
    app.listen(PORT, () => console.log('User Service running on port ' + PORT));
  })
  .catch(err => console.error(err));
`);

console.log('Successfully injected microservices business logic!');
