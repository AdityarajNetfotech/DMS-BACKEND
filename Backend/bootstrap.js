const fs = require('fs');
const path = require('path');

const services = ['super-admin-service', 'tenant-service', 'user-service', 'email-service'];
const rootDir = path.join(__dirname, '..');

services.forEach(service => {
  const servicePath = path.join(rootDir, service);
  const srcPath = path.join(servicePath, 'src');
  
  // Create folders
  fs.mkdirSync(srcPath, { recursive: true });

  // Create package.json
  const packageJson = {
    name: service,
    version: "1.0.0",
    main: "src/server.js",
    scripts: {
      start: "node src/server.js",
      dev: "nodemon src/server.js"
    },
    dependencies: {
      express: "^4.19.2",
      mongoose: "^8.4.1",
      dotenv: "^16.4.5",
      cors: "^2.8.5"
    }
  };
  
  if (service === 'email-service') {
    packageJson.dependencies.nodemailer = "^6.9.13";
    packageJson.dependencies.amqplib = "^0.10.4";
  } else {
    packageJson.dependencies.amqplib = "^0.10.4"; // For emitting events
  }

  fs.writeFileSync(path.join(servicePath, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create Dockerfile
  let port = 3001;
  if (service === 'auth-service') port = 3002;
  if (service === 'tenant-service') port = 3003;
  if (service === 'user-service') port = 3004;
  if (service === 'email-service') port = 3005;

  const dockerfile = `FROM node:18-alpine
WORKDIR /usr/src/app
COPY ${service}/package*.json ./
RUN npm install
COPY ${service}/src ./src
COPY shared ./src/shared
EXPOSE ${port}
CMD ["npm", "start"]`;
  fs.writeFileSync(path.join(servicePath, 'Dockerfile'), dockerfile);

  // Create basic server.js
  const serverJs = `require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: '${service}' }));

const PORT = ${port};
app.listen(PORT, () => console.log('${service} running on port ' + PORT));
`;
  fs.writeFileSync(path.join(srcPath, 'server.js'), serverJs);
});

console.log('Services generated successfully.');
