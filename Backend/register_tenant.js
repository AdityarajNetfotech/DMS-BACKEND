const mongoose = require('./auth-service/node_modules/mongoose');
require('./auth-service/node_modules/dotenv').config();

const uri = process.env.MONGO_MASTER_URI || 'mongodb+srv://aditya_db_user:DmsAdmin123@cluster0.ppekiky.mongodb.net/master_db?retryWrites=true&w=majority&appName=Cluster0';

async function registerTenant(slug = 'acmesolutions', name = 'Acme Solutions') {
  try {
    console.log(`Connecting to Master MongoDB: ${uri.split('@')[1] || uri}...`);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log('Connected to Master Database successfully.');

    const db = mongoose.connection.db;
    const existing = await db.collection('tenants').findOne({ companySlug: slug });

    if (existing) {
      console.log(`Tenant '${slug}' is ALREADY registered in DMS Master DB.`);
      console.log('Details:', {
        id: existing._id,
        name: existing.companyName,
        code: existing.companyCode,
        isActive: existing.isActive
      });
    } else {
      console.log(`Tenant '${slug}' not found. Registering in DMS Master DB...`);
      const baseUri = uri.split('?')[0].replace(/\/[^/]+$/, '');
      const queryParams = uri.includes('?') ? '?' + uri.split('?')[1] : '';
      const tenantDbUri = `${baseUri}/tenant_${slug.replace(/[^a-z0-9]/g, '_')}${queryParams}`;

      const newTenant = {
        companyName: name,
        companySlug: slug,
        companyCode: slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
        dbUri: tenantDbUri,
        isActive: true,
        registrationDate: new Date(),
        subscription: {
          plan: 'Enterprise',
          status: 'Active',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('tenants').insertOne(newTenant);
      console.log(`SUCCESS: Tenant '${slug}' successfully created with ID: ${result.insertedId}`);
    }

    await mongoose.disconnect();
    console.log('Done.');
  } catch (error) {
    console.error('Registration failed:', error.message);
  }
}

const targetSlug = process.argv[2] || 'acmesolutions';
const targetName = process.argv[3] || 'Acme Solutions';
registerTenant(targetSlug, targetName);

