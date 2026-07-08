const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const services = ['super-admin-service', 'tenant-service', 'user-service', 'auth-service'];

services.forEach(service => {
  const p = path.join(rootDir, service, 'package.json');
  if (fs.existsSync(p)) {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.dependencies.bcrypt = '^5.1.1';
    // Ensure jsonwebtoken is also present in auth-service
    if (service === 'auth-service') pkg.dependencies.jsonwebtoken = '^9.0.2';
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
  }
});

const gatewayServerFile = path.join(rootDir, 'api-gateway/src/server.js');
let gatewayCode = fs.readFileSync(gatewayServerFile, 'utf8');
gatewayCode = gatewayCode.replace(/console\.log\(\\\`API Gateway running on port \\\$\\{PORT\\}\\\`\)/, "console.log('API Gateway running on port ' + PORT)");
gatewayCode = gatewayCode.replace(/console\.log\(\`API Gateway running on port \$\{PORT\}\`\)/, "console.log('API Gateway running on port ' + PORT)");

// Just manually rewrite the line to be absolutely safe
gatewayCode = gatewayCode.replace(/app\.listen\(PORT.*/, "app.listen(PORT, () => console.log('API Gateway running on port ' + PORT));");

fs.writeFileSync(gatewayServerFile, gatewayCode);

console.log('Fixed missing bcrypt and API Gateway syntax error!');
