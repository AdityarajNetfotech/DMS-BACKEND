require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(
  helmet({
    frameguard: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  })
);
app.use(cors());
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  validate: { trustProxy: false, xForwardedForHeader: false },
  max: process.env.NODE_ENV === 'production' ? 100 : 10000, // Safe high limit for local development
});
app.use(limiter);

// Pre-configured microservice proxies
const superAdminProxy = createProxyMiddleware({ target: process.env.SUPER_ADMIN_SERVICE_URL || 'http://super-admin-service:3001', changeOrigin: true });
const tenantProxy = createProxyMiddleware({ target: process.env.TENANT_SERVICE_URL || 'http://tenant-service:3003', changeOrigin: true });
const authProxy = createProxyMiddleware({ target: process.env.AUTH_SERVICE_URL || 'http://auth-service:3002', changeOrigin: true });
const userProxy = createProxyMiddleware({ target: process.env.USER_SERVICE_URL || 'http://user-service:3004', changeOrigin: true });
const managerProxy = createProxyMiddleware({ target: process.env.MANAGER_SERVICE_URL || 'http://manager-service:3006', changeOrigin: true });
const viewerProxy = createProxyMiddleware({ target: process.env.VIEWER_SERVICE_URL || 'http://viewer-service:3007', changeOrigin: true });

const authRegex = /^\/api\/[^/]+\/auth/;
const usersRegex = /^\/api\/[^/]+\/users/;
const departmentsRegex = /^\/api\/[^/]+\/departments/;
const brandingRegex = /^\/api\/[^/]+\/branding/;
const managerRegex = /^\/api\/[^/]+\/manager/;
const viewerRegex = /^\/api\/[^/]+\/viewer/;

// Proxy handler routing requests to corresponding microservices
app.use((req, res, next) => {
  if (req.path.startsWith('/api/super-admin')) {
    return superAdminProxy(req, res, next);
  }
  
  if (req.path.startsWith('/api/tenant')) {
    return tenantProxy(req, res, next);
  }

  if (authRegex.test(req.path)) {
    return authProxy(req, res, next);
  }

  if (usersRegex.test(req.path) || departmentsRegex.test(req.path) || brandingRegex.test(req.path)) {
    return userProxy(req, res, next);
  }

  if (managerRegex.test(req.path)) {
    return managerProxy(req, res, next);
  }

  if (viewerRegex.test(req.path)) {
    return viewerProxy(req, res, next);
  }

  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API Gateway running on port ' + PORT));
