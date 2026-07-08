const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const services = ['super-admin-service', 'tenant-service', 'user-service', 'auth-service'];

services.forEach(service => {
  const p = path.join(rootDir, service, 'package.json');
  if (fs.existsSync(p)) {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.dependencies.jsonwebtoken = '^9.0.2';
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
  }
});

console.log('Fixed missing jsonwebtoken in all services');
