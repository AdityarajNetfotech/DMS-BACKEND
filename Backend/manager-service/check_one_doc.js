const mongoose = require('mongoose');
const { getTenantConnection } = require('./src/shared/tenant.db');
const Tenant = require('./src/shared/models/tenant.model');

async function check() {
  await mongoose.connect(process.env.MONGO_MASTER_URI);
  const tenant = await Tenant.findOne({ companySlug: 'acmesolutions' });
  const conn = await getTenantConnection('acmesolutions', tenant.dbUri);
  await conn.asPromise();

  const doc = await conn.collection('documents').findOne({ _id: new mongoose.Types.ObjectId('6af53675d194636a51496473') });
  console.log('Doc signatures:', JSON.stringify(doc.signatures, null, 2));
  console.log('Doc approvalWorkflow:', JSON.stringify(doc.approvalWorkflow, null, 2));
  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });

