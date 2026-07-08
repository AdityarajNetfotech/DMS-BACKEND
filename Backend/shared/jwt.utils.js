const jwt = require('jsonwebtoken');

const generateTokens = (user, companySlug = null) => {
  const payload = {
    userId: user._id,
    role: user.role,
    companySlug,
    mustChangePassword: user.mustChangePassword,
    departmentId: user.departmentId || null,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
  });

  return { accessToken, refreshToken };
};

const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

module.exports = { generateTokens, verifyToken };
