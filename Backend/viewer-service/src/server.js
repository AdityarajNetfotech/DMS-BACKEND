require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const logger = require('./config/logger');
const viewerRoutes = require('./routes/viewer.routes');
const { errorHandler } = require('./shared/error.handler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 10000,
});
app.use(limiter);

// Serve local upload files publicly for preview/downloads if stored locally
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Mount Routes
app.use('/api/:companySlug/viewer', viewerRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Viewer service is healthy' });
});

// Centralized error handling
app.use(errorHandler);

// Connect to Mongoose Master DB and Start Server
mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    logger.info('Viewer Service connected to Master Database');
    const PORT = process.env.PORT || 3007;
    app.listen(PORT, () => {
      logger.info(`Viewer Service is listening on port ${PORT}`);
    });
  })
  .catch(err => {
    logger.error('Failed to connect to Mongo Master DB:', err);
  });
