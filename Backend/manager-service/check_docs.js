const mongoose = require('mongoose');
const { getTenantConnection } = require('./src/shared/tenant.db');
const Tenant = require('./src/shared/models/tenant.model');

async function checkDocs() {
  await mongoose.connect(process.env.MONGO_MASTER_URI);
  const tenant = await Tenant.findOne({ companySlug: 'acmesolutions' });
  const conn = await getTenantConnection('acmesolutions', tenant.dbUri);
  await conn.asPromise();

  for (const ref of ['KYC-2026-00014', 'KYC-2026-00013', 'KYC-2026-00012', 'KYC-2026-00011']) {
    const docs = await conn.collection('documents').find({ customerRef: ref }).toArray();
    console.log(`\n=== Documents for ${ref} (count: ${docs.length}) ===`);
    docs.forEach(d => {
      console.log(`Doc ID: ${d._id}, name: ${d.name}, approvalStatus: ${d.approvalStatus}`);
      if (Array.isArray(d.signatures)) {
        d.signatures.forEach(s => {
          console.log(`  Step ${s.step}: [${s.slot}] ${s.signerName} (${s.signerEmail}) -> status: ${s.status}, hasSig: ${Boolean(s.signature)}`);
        });
      } else {
        console.log('  No signatures array');
      }
    });
  }
  process.exit(0);
}
checkDocs().catch(e => { console.error(e); process.exit(1); });

