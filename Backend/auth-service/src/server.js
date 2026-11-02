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

const { authenticate } = require('./shared/auth.middleware');
const router = express.Router({ mergeParams: true });

router.post('/login', tenantResolver, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await req.User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: `Account is ${user.status}` });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    // Log User Login activity
    if (req.ActivityLog) {
      try {
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const userAgent = req.headers['user-agent'] || '';
        let browser = 'Unknown', operatingSystem = 'Unknown';
        if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Safari')) browser = 'Safari';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        if (userAgent.includes('Windows')) operatingSystem = 'Windows';
        else if (userAgent.includes('Macintosh')) operatingSystem = 'macOS';
        else if (userAgent.includes('Linux')) operatingSystem = 'Linux';

        const log = new req.ActivityLog({
          managerId: user._id,
          tenantId: req.tenant.companySlug,
          action: 'User Login',
          resource: 'Auth',
          resourceId: user._id,
          resourceName: user.name || user.email,
          details: { role: user.role, email: user.email },
          ipAddress,
          browser,
          operatingSystem
        });
        await log.save();
      } catch (logErr) {
        console.error('Failed to log login activity:', logErr);
      }
    }

    const tokens = generateTokens(user, req.tenant.companySlug);
    res.status(200).json({ 
      success: true, 
      tokens, 
      role: user.role,
      mustChangePassword: user.mustChangePassword 
    });
  } catch (err) { next(err); }
});

router.post('/logout', tenantResolver, authenticate, async (req, res, next) => {
  try {
    if (req.ActivityLog && req.user) {
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      const userAgent = req.headers['user-agent'] || '';
      let browser = 'Unknown', operatingSystem = 'Unknown';
      if (userAgent.includes('Chrome')) browser = 'Chrome';
      else if (userAgent.includes('Safari')) browser = 'Safari';
      else if (userAgent.includes('Firefox')) browser = 'Firefox';
      if (userAgent.includes('Windows')) operatingSystem = 'Windows';
      else if (userAgent.includes('Macintosh')) operatingSystem = 'macOS';
      else if (userAgent.includes('Linux')) operatingSystem = 'Linux';

      const user = await req.User.findById(req.user.userId);
      const log = new req.ActivityLog({
        managerId: req.user.userId,
        tenantId: req.tenant.companySlug,
        action: 'User Logout',
        resource: 'Auth',
        resourceId: req.user.userId,
        resourceName: user ? (user.name || user.email) : 'User',
        details: { role: req.user.role },
        ipAddress,
        browser,
        operatingSystem
      });
      await log.save().catch(e => console.error('Failed to log logout activity:', e));
    }
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) { next(err); }
});

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
const PASSWORD_COMPLEXITY_MSG = 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.';

router.post('/change-password', tenantResolver, authenticate, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || !PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({ success: false, message: PASSWORD_COMPLEXITY_MSG });
    }

    const user = await req.User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!(await user.comparePassword(oldPassword))) {
      return res.status(400).json({ success: false, message: 'Invalid old password' });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    const tokens = generateTokens(user, req.tenant.companySlug);
    res.status(200).json({ success: true, message: 'Password updated successfully', tokens });
  } catch (err) { next(err); }
});

const crypto = require('crypto');
const bcrypt = require('bcrypt');

router.post('/forgot-password', tenantResolver, async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await req.User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes
    
    user.otp = await bcrypt.hash(otp, 10);
    user.otpExpiresAt = otpExpiresAt;
    user.resetToken = null; 
    await user.save();

    // Use fetch instead of amqp to avoid dependencies
    const EMAIL_URL = process.env.EMAIL_SERVICE_URL || 'http://email-service:3005';
    fetch(`${EMAIL_URL}/api/email/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        companyName: req.tenant.companyName,
        otp: otp
      })
    }).catch(err => console.error('Failed to trigger email service:', err));

    res.status(200).json({ success: true, message: 'OTP sent to email' });
  } catch (err) { next(err); }
});

router.post('/verify-otp', tenantResolver, async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const user = await req.User.findOne({ email });
    if (!user || !user.otp || !user.otpExpiresAt) return res.status(400).json({ success: false, message: 'Invalid request' });

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    const isValid = await bcrypt.compare(otp, user.otp);
    if (!isValid) return res.status(400).json({ success: false, message: 'Invalid OTP' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = await bcrypt.hash(resetToken, 10);
    user.otp = null;
    user.otpExpiresAt = null;
    await user.save();

    res.status(200).json({ success: true, resetToken });
  } catch (err) { next(err); }
});

router.post('/reset-password', tenantResolver, async (req, res, next) => {
  try {
    const { email, resetToken, newPassword } = req.body;
    if (!newPassword || !PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({ success: false, message: PASSWORD_COMPLEXITY_MSG });
    }

    const user = await req.User.findOne({ email });
    if (!user || !user.resetToken) return res.status(400).json({ success: false, message: 'Invalid request' });

    const isValid = await bcrypt.compare(resetToken, user.resetToken);
    if (!isValid) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

    user.password = newPassword;
    user.mustChangePassword = false;
    user.resetToken = null;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (err) { next(err); }
});

// Single-Sign-On Exchange: redeem VerifyChain one-time SSO token for DMS session
router.post('/sso-exchange', tenantResolver, async (req, res, next) => {
  try {
    const { ssoToken } = req.body;
    if (!ssoToken) {
      return res.status(400).json({ success: false, message: 'ssoToken is required' });
    }

    const slug = req.params?.companySlug || req.tenant?.companySlug;
    const candidateUrls = [
      process.env.VC_GATEWAY_URL,
      process.env.VC_AUTH_SERVICE_URL,
      slug ? `https://${slug}.intellinexa.in` : null,
      'https://intellinexa.in',
      'http://verifychain-api-gateway:5000',
      'http://verifychain-auth-service:4001',
      'http://host.docker.internal:5000',
      'http://host.docker.internal:4001',
      'http://localhost:5000',
      'http://localhost:4001',
      'http://localhost:5001'
    ].filter(Boolean);

    let vcResp = null;
    let lastError = null;

    // Contact VerifyChain auth service to verify and consume the single-use token
    for (const baseUrl of candidateUrls) {
      try {
        const verifyEndpoint = `${baseUrl}/api/auth/sso-verify?token=${encodeURIComponent(ssoToken)}`;
        const resp = await fetch(verifyEndpoint, {
          headers: { 'Accept': 'application/json' }
        });
        if (resp.ok || resp.status === 401 || resp.status === 400) {
          vcResp = resp;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!vcResp) {
      return res.status(502).json({
        success: false,
        message: 'Could not contact VerifyChain Auth Service for SSO verification',
        error: lastError ? lastError.message : 'Connection failed'
      });
    }

    const vcJson = await vcResp.json().catch(() => ({}));
    if (!vcResp.ok || !vcJson.success) {
      return res.status(vcResp.status || 401).json({
        success: false,
        message: vcJson.message || 'Invalid or expired SSO token'
      });
    }

    const payload = vcJson.data || vcJson;
    const { email, slug: vcSlug } = payload;

    const currentSlug = req.tenant?.companySlug || req.params.companySlug;
    if (vcSlug && currentSlug && vcSlug.toLowerCase() !== currentSlug.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: `Tenant mismatch: SSO token is for tenant '${vcSlug}', but target workspace is '${currentSlug}'`
      });
    }

    // Helper to format VerifyChain role slug to a clean, user-facing role title
    const formatVcRole = (rawRole) => {
      if (!rawRole) return 'Manager';
      const r = String(rawRole).toLowerCase().trim().replace(/[-_]/g, ' ');
      if (r === 'auditor') return 'Auditor';
      if (r === 'business user' || r === 'business_user') return 'Business User';
      if (r === 'compliance officer' || r === 'compliance_officer' || r === 'compliance user') return 'Compliance Officer';
      if (r === 'company admin' || r === 'company_admin') return 'Company Admin';
      if (r === 'super admin' || r === 'superadmin') return 'Super Admin';
      return r.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    const resolvedName = payload.name || (email ? email.split('@')[0] : 'User');
    const capName = resolvedName.charAt(0).toUpperCase() + resolvedName.slice(1);

    // Auto-provision or find user in DMS Tenant DB
    let user = await req.User.findOne({ email });
    if (!user) {
      const generatedPassword = crypto.randomBytes(16).toString('hex') + 'A1!';
      user = new req.User({
        name: capName,
        email: email,
        password: generatedPassword,
        role: 'Manager',
        vcRole: payload.role || null,
        status: 'Active',
        mustChangePassword: false
      });
      await user.save();
    } else {
      let changed = false;
      if (payload.role && user.vcRole !== payload.role) {
        user.vcRole = payload.role;
        changed = true;
      }
      if (capName && (!user.name || user.name.toLowerCase() === email.split('@')[0].toLowerCase())) {
        user.name = capName;
        changed = true;
      }
      if (changed) {
        await user.save();
      }
    }

    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: `Account is ${user.status}` });
    }

    user.lastLogin = new Date();
    await user.save();

    const displayRole = formatVcRole(user.vcRole || payload.role);
    const displayName = user.name ? (user.name.charAt(0).toUpperCase() + user.name.slice(1)) : capName;

    if (req.ActivityLog) {
      try {
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const log = new req.ActivityLog({
          managerId: user._id,
          tenantId: req.tenant.companySlug,
          action: 'User SSO Login',
          resource: 'Auth',
          resourceId: user._id,
          resourceName: displayName,
          details: { role: displayRole, rawRole: user.role, email: user.email, provider: 'VerifyChain' },
          ipAddress
        });
        await log.save();
      } catch (logErr) {
        console.error('Failed to log SSO activity:', logErr);
      }
    }

    const tokens = generateTokens(user, req.tenant.companySlug);
    return res.status(200).json({
      success: true,
      tokens,
      role: displayRole,
      displayRole: displayRole,
      vcRole: user.vcRole || payload.role,
      user: {
        id: user._id,
        name: displayName,
        email: user.email,
        role: displayRole,
        displayRole: displayRole,
        vcRole: user.vcRole || payload.role
      }
    });
  } catch (err) {
    next(err);
  }
});

app.use('/api/:companySlug/auth', router);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('Auth Service connected to Master DB');
    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => console.log('Auth Service running on port ' + PORT));
  })
  .catch(err => console.error(err));