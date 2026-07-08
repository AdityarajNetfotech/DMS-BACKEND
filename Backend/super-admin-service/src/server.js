require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { errorHandler } = require('./shared/error.handler');
const superAdminRoutes = require('./routes/superAdmin.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/super-admin', superAdminRoutes);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('Super Admin Service connected to Master DB');
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => console.log('Super Admin Service running on port ' + PORT));
  })
  .catch(err => console.error(err));