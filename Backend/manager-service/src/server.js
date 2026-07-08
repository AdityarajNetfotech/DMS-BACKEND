require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');

const logger = require('./config/logger');
const managerRoutes = require('./routes/manager.routes');
const { errorHandler } = require('./shared/error.handler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json());

// Enable rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 10000,
});
app.use(limiter);

// Serve local upload files publicly
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Swagger API Documentation setup
const openapiSpec = require('./swagger/openapi.json');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Mount Routes
app.use('/api/:companySlug/manager', managerRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Manager service is healthy' });
});

// Error handling middleware
app.use(errorHandler);

// Connect Mongoose
mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    logger.info('Manager Service connected to Master Database');
    const PORT = process.env.PORT || 3006;
    app.listen(PORT, () => {
      logger.info(`Manager Service is listening on port ${PORT}`);
    });
  })
  .catch(err => {
    logger.error('Failed to connect to Mongo Master DB:', err);
  });
