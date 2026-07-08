require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 10000, // Safe high limit for local development
});
app.use(limiter);

// Dynamic proxy handler that forwards full paths to internal microservices
app.use((req, res, next) => {
  if (req.path.startsWith('/api/super-admin')) {
    return createProxyMiddleware({
      target: process.env.SUPER_ADMIN_SERVICE_URL || 'http://super-admin-service:3001',
      changeOrigin: true,
    })(req, res, next);
  }
  
  if (req.path.startsWith('/api/tenant')) {
    return createProxyMiddleware({
      target: process.env.TENANT_SERVICE_URL || 'http://tenant-service:3003',
      changeOrigin: true,
    })(req, res, next);
  }

  const authRegex = /^\/api\/[^/]+\/auth/;
  const usersRegex = /^\/api\/[^/]+\/users/;
  const departmentsRegex = /^\/api\/[^/]+\/departments/;
  const brandingRegex = /^\/api\/[^/]+\/branding/;
  const managerRegex = /^\/api\/[^/]+\/manager/;
  const viewerRegex = /^\/api\/[^/]+\/viewer/;

  if (authRegex.test(req.path)) {
    return createProxyMiddleware({
      target: process.env.AUTH_SERVICE_URL || 'http://auth-service:3002',
      changeOrigin: true,
    })(req, res, next);
  }

  if (usersRegex.test(req.path) || departmentsRegex.test(req.path) || brandingRegex.test(req.path)) {
    return createProxyMiddleware({
      target: process.env.USER_SERVICE_URL || 'http://user-service:3004',
      changeOrigin: true,
    })(req, res, next);
  }

  if (managerRegex.test(req.path)) {
    return createProxyMiddleware({
      target: process.env.MANAGER_SERVICE_URL || 'http://manager-service:3006',
      changeOrigin: true,
    })(req, res, next);
  }

  if (viewerRegex.test(req.path)) {
    return createProxyMiddleware({
      target: process.env.VIEWER_SERVICE_URL || 'http://viewer-service:3007',
      changeOrigin: true,
    })(req, res, next);
  }

  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API Gateway running on port ' + PORT));
