const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Manager Microservice API',
    version: '1.0.0',
    description: 'API Documentation for DMS Manager Microservice managing Folders and Documents',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'API Gateway Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: [], // Can write annotations or use swagger json directly
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
