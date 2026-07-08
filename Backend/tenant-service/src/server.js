require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { errorHandler } = require('./shared/error.handler');
const tenantRoutes = require('./routes/tenant.routes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api/tenant', tenantRoutes);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('Tenant Service connected to Master DB');
    const PORT = process.env.PORT || 3003;
    app.listen(PORT, () => console.log('Tenant Service running on port ' + PORT));
  })
  .catch(err => console.error(err));