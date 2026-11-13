const mongoose = require('mongoose');
const { getTenantConnection } = require('./src/shared/tenant.db');
const Tenant = require('./src/shared/models/tenant.model');

async function check() {
  await mongoose.connect(process.env.MONGO_MASTER_URI);
  const tenant = await Tenant.findOne({ companySlug: 'acmesolutions' });
  const conn = await getTenantConnection('acmesolutions', tenant.dbUri);
  await conn.asPromise();
  const users = await conn.collection('users').find({
    email: { $in: ['aditya@acmesolutions.com', 'soudip@acmesolutions.com', 'abhishek@acmesolutions.com'] }
  }).toArray();
  console.log('Users found in DMS:');
  users.forEach(u => console.log({
    email: u.email,
    name: u.name,
    hasSignature: Boolean(u.signature),
    signatureType: u.signatureType,
    signatureLength: u.signature ? u.signature.length : 0
  }));
  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });

