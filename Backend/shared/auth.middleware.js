const { verifyToken } = require('./jwt.utils');

const authenticate = (req, res, next) => {
  console.log(`[authenticate] entered, authorization header: ${req.headers.authorization ? 'Present' : 'Missing'}`);
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      console.log(`[authenticate] failed: no token`);
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const decoded = verifyToken(token);
    req.user = decoded; // { userId, role, companySlug, mustChangePassword }
    
    if (decoded.mustChangePassword && !req.originalUrl.endsWith('/change-password')) {
      console.log(`[authenticate] failed: password change required`);
      return res.status(403).json({ success: false, message: 'Password change required', mustChangePassword: true });
    }

    console.log(`[authenticate] success for user: ${decoded.userId}, role: ${decoded.role}`);
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    console.log(`[authorizeRoles] checking roles: ${roles.join(', ')}, user role: ${req.user ? req.user.role : 'None'}`);
    if (!req.user || !roles.includes(req.user.role)) {
      console.log(`[authorizeRoles] forbidden`);
      return res.status(403).json({ success: false, message: `Forbidden, requires one of roles: ${roles.join(', ')}` });
    }
    console.log(`[authorizeRoles] authorized`);
    next();
  };
};

module.exports = { authenticate, authorizeRoles };
