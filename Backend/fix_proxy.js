const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const gatewayServerFile = path.join(rootDir, 'api-gateway/src/server.js');
let gatewayCode = fs.readFileSync(gatewayServerFile, 'utf8');

gatewayCode = gatewayCode.replace(/app\.use\('\/api\/super-admin', createProxyMiddleware\(\{([\s\S]*?)\}\)\);/g, "app.use('/api/super-admin', createProxyMiddleware({$1, pathRewrite: { '^/api/super-admin': '/api/super-admin' } }));");
gatewayCode = gatewayCode.replace(/app\.use\('\/api\/tenant', createProxyMiddleware\(\{([\s\S]*?)\}\)\);/g, "app.use('/api/tenant', createProxyMiddleware({$1, pathRewrite: { '^/api/tenant': '/api/tenant' } }));");
gatewayCode = gatewayCode.replace(/app\.use\('\/api\/:companySlug\/auth', createProxyMiddleware\(\{([\s\S]*?)\}\)\);/g, "app.use('/api/:companySlug/auth', createProxyMiddleware({$1, pathRewrite: { '^/api': '/api' } }));");
gatewayCode = gatewayCode.replace(/app\.use\('\/api\/:companySlug\/users', createProxyMiddleware\(\{([\s\S]*?)\}\)\);/g, "app.use('/api/:companySlug/users', createProxyMiddleware({$1, pathRewrite: { '^/api': '/api' } }));");

fs.writeFileSync(gatewayServerFile, gatewayCode);

console.log('Fixed Proxy Path Rewriting');
