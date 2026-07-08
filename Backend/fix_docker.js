const fs = require('fs');
const path = require('path');

const services = ['super-admin-service', 'tenant-service', 'user-service', 'email-service'];
const rootDir = __dirname;

services.forEach(service => {
  const servicePath = path.join(rootDir, service);
  let port = 3001;
  if (service === 'tenant-service') port = 3003;
  if (service === 'user-service') port = 3004;
  if (service === 'email-service') port = 3005;

  const packageJson = {
    name: service,
    version: "1.0.0",
    main: "src/server.js",
    scripts: { start: "node src/server.js", dev: "nodemon src/server.js" },
    dependencies: {
      express: "^4.19.2",
      mongoose: "^8.4.1",
      dotenv: "^16.4.5",
      cors: "^2.8.5"
    }
  };
  
  if (service === 'email-service') {
    packageJson.dependencies.nodemailer = "^6.9.13";
  }

  fs.writeFileSync(path.join(servicePath, 'package.json'), JSON.stringify(packageJson, null, 2));

  const dockerfile = `FROM node:18-alpine
WORKDIR /usr/src/app
COPY ${service}/package*.json ./
RUN npm install
COPY ${service}/src ./src
COPY shared ./src/shared
EXPOSE ${port}
CMD ["npm", "start"]`;

  fs.writeFileSync(path.join(servicePath, 'Dockerfile'), dockerfile);
});

console.log('Fixed Dockerfiles and package.jsons');
