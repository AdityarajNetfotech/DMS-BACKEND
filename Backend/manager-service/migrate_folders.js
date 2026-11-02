const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const casemapPath = path.join(__dirname, 'casemap.json');
  const caseMap = JSON.parse(fs.readFileSync(casemapPath, 'utf8'));
  console.log(`Loaded user mappings for ${Object.keys(caseMap).length} cases from casemap.json.`);

  const uri = 'mongodb+srv://aditya_db_user:DmsAdmin123@cluster0.ppekiky.mongodb.net/tenant_acmesolutions?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const folders = await db.collection('folders').find({ parentFolder: { $ne: null }, isDeleted: false }).toArray();
  console.log(`Scanning ${folders.length} child folders in MongoDB...`);

  let updatedCount = 0;
  for (const folder of folders) {
    const match = folder.name.match(/^([A-Z]+-\d{4}-\d+)/i);
    if (!match) continue;
    const ref = match[1].toUpperCase();
    const info = caseMap[ref];

    const updateFields = {
      caseRef: ref,
      allowedEmails: info ? info.allowedEmails : [],
      allowedNames: info ? info.allowedNames : [],
      assignedEmail: info ? info.assignedEmail : null,
      creatorEmail: info ? info.creatorEmail : null
    };

    await db.collection('folders').updateOne(
      { _id: folder._id },
      { $set: updateFields }
    );
    updatedCount++;
  }

  console.log(`Successfully migrated and tagged ${updatedCount} case folders in MongoDB!`);

  // Verify Soudip accessible folders
  const soudipFolders = await db.collection('folders').find({
    parentFolder: { $ne: null },
    isDeleted: false,
    $or: [
      { allowedEmails: 'soudip@acmesolutions.com' },
      { assignedEmail: 'soudip@acmesolutions.com' },
      { allowedNames: 'soudip' }
    ]
  }).toArray();

  console.log(`\nSoudip will see exactly ${soudipFolders.length} case folders in DMS:`);
  soudipFolders.forEach(f => console.log(` - ${f.name} (Assigned: ${f.assignedEmail})`));

  // Verify Aditya accessible folders
  const adityaFolders = await db.collection('folders').find({
    parentFolder: { $ne: null },
    isDeleted: false,
    $or: [
      { allowedEmails: 'aditya@acmesolutions.com' },
      { assignedEmail: 'aditya@acmesolutions.com' },
      { allowedNames: 'aditya' }
    ]
  }).toArray();
  console.log(`\nAditya will see ${adityaFolders.length} case folders in DMS.`);

  await mongoose.disconnect();
}

migrate().catch(console.error);
