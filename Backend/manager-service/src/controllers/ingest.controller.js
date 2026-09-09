const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const securityHelper = require('../helpers/security.helper');
const storageHelper = require('../helpers/storage.helper');
const aiHelper = require('../helpers/ai.helper');
const activityService = require('../services/activity.service');
const apiKeySchema = require('../models/apiKey.model');

/**
 * POST /api/:companySlug/ingest/document
 * Dedicated headless ingestion endpoint for external systems (LOS / Core Banking / CRM)
 */
const ingestDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No document file uploaded' });
    }

    const Document = req.Document;
    const Folder = req.Folder;
    const tenantId = req.params.companySlug || req.externalSystem?.tenantId;

    const file = req.file;
    const rawBuffer = fs.readFileSync(file.path);
    const ext = path.extname(file.originalname).toLowerCase();
    const docName = req.body.name || path.basename(file.originalname, ext);

    // 1. Anti-Virus & File Signature Verification
    const malwareScan = await securityHelper.scanFileForMalware(rawBuffer, file.originalname);
    if (!malwareScan.isClean) {
      // Delete temporary file
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(422).json({
        success: false,
        message: `Security Check Failed: ${malwareScan.threatFound}`,
        error: 'MALWARE_OR_INVALID_SIGNATURE',
        engine: malwareScan.engine
      });
    }

    // 2. Cryptographic SHA-256 Hashing & Deduplication
    const fileHash = securityHelper.computeFileHash(rawBuffer);
    const allowDuplicate = req.body.allowDuplicate === 'true' || req.body.allowDuplicate === true;

    const existingDuplicate = await Document.findOne({
      fileHash,
      tenantId,
      isDeleted: false
    });

    if (existingDuplicate && !allowDuplicate) {
      // Delete temporary file
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(409).json({
        success: false,
        message: 'Duplicate document detected: Identical file already exists in DMS.',
        data: {
          isDuplicate: true,
          existingDocumentId: existingDuplicate._id,
          existingDocumentName: existingDuplicate.name,
          existingDocumentType: existingDuplicate.documentType,
          uploadedAt: existingDuplicate.createdAt
        }
      });
    }

    // 3. OCR & AI Classification & Extraction
    const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
    const openAiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;

    let extractedText = '';
    try {
      const imgMimes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };
      if (imgMimes[ext]) {
        extractedText = await aiHelper.ocrWithGemini(rawBuffer, imgMimes[ext], geminiKey, openAiKey);
      }
    } catch (ocrErr) {
      console.warn('OCR during external ingestion failed:', ocrErr.message);
    }

    const aiMeta = await aiHelper.classifyAndExtractMetadata(
      extractedText || docName,
      file.originalname,
      geminiKey,
      openAiKey
    );

    // 4. Upload to Storage
    const uploadResult = await storageHelper.uploadToStorage(file);

    // 5. Build Document Record with metadata overrides from LOS/CBS if provided
    const document = new Document({
      name: docName,
      originalFileName: file.originalname,
      fileType: ext.replace('.', '').toUpperCase(),
      mimeType: file.mimetype,
      extension: ext,
      folderId: req.body.folderId || null,
      tenantId,
      uploadedBy: req.user?.userId || null,
      fileSize: file.size,
      storageUrl: uploadResult.url,
      description: req.body.description || `Ingested via ${req.externalSystem?.systemName || 'LOS API'}`,
      tags: req.body.tags ? (Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags]) : (aiMeta.suggestedTags || []),
      extractedText,
      // Security & Deduplication
      fileHash,
      isMalwareScanned: true,
      scanResult: 'Clean',
      ingestionSource: req.externalSystem?.systemName ? `LOS API (${req.externalSystem.systemName})` : 'API Ingestion Gateway',
      // Banking metadata (LOS provided payload takes priority over AI extracted)
      documentType: req.body.documentType || aiMeta.documentType || '',
      customerId: req.body.customerId || aiMeta.customerId || '',
      customerName: req.body.customerName || aiMeta.customerName || '',
      customerRef: req.body.customerRef || aiMeta.customerRef || '',
      facilityNumber: req.body.facilityNumber || req.body.facilityRef || aiMeta.facilityNumber || '',
      facilityRef: req.body.facilityRef || aiMeta.facilityRef || '',
      branch: req.body.branch || aiMeta.branch || '',
      branchCode: req.body.branchCode || aiMeta.branchCode || '',
      documentDate: req.body.documentDate ? new Date(req.body.documentDate) : (aiMeta.documentDate ? new Date(aiMeta.documentDate) : null),
      executionDate: req.body.executionDate ? new Date(req.body.executionDate) : (aiMeta.executionDate ? new Date(aiMeta.executionDate) : null),
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : (aiMeta.expiryDate ? new Date(aiMeta.expiryDate) : null),
      accountNumber: req.body.accountNumber || aiMeta.accountNumber || '',
      cifNumber: req.body.cifNumber || aiMeta.cifNumber || '',
      ifscCode: req.body.ifscCode || aiMeta.ifscCode || '',
      accountType: req.body.accountType || aiMeta.accountType || '',
      signatory: req.body.signatory || aiMeta.signatory || '',
      partner: req.body.partner || aiMeta.partner || '',
      typeOfService: req.body.typeOfService || aiMeta.typeOfService || '',
      otherBankingMetadata: aiMeta.otherBankingMetadata || {},
      validationStatus: aiMeta.validationStatus || 'Valid',
      missingMandatoryFields: aiMeta.missingMandatoryFields || [],
      aiClassification: aiMeta.documentType || '',
      aiConfidence: aiMeta.confidence || '',
      aiProcessedAt: new Date()
    });

    await document.save();

    return res.status(201).json({
      success: true,
      message: 'Document successfully ingested, scanned, and cataloged.',
      receipt: {
        documentId: document._id,
        name: document.name,
        fileHash: document.fileHash,
        documentType: document.documentType,
        customerName: document.customerName,
        accountNumber: document.accountNumber,
        cifNumber: document.cifNumber,
        branch: document.branch,
        validationStatus: document.validationStatus,
        missingMandatoryFields: document.missingMandatoryFields,
        storageUrl: document.storageUrl,
        ingestedAt: document.createdAt,
        securityScan: 'Clean'
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/:companySlug/manager/documents/bulk-zip
 * Bulk Ingestion from a ZIP file containing documents and an optional manifest.json / manifest.csv
 */
const bulkZipIngest = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No ZIP archive uploaded' });
    }

    const Document = req.Document;
    const Folder = req.Folder;
    const tenantId = req.params.companySlug;
    const userId = req.user?.userId;

    const zipPath = req.file.path;
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    let manifest = {};
    const manifestEntry = zipEntries.find(e => e.entryName.toLowerCase().endsWith('manifest.json'));
    if (manifestEntry) {
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      } catch (e) {
        console.warn('Could not parse manifest.json from zip:', e.message);
      }
    }

    const results = {
      total: 0,
      successful: 0,
      duplicatesSkipped: 0,
      failed: 0,
      documents: []
    };

    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    for (const entry of zipEntries) {
      if (entry.isDirectory || entry.entryName.startsWith('__MACOSX') || entry.entryName.toLowerCase().endsWith('manifest.json')) {
        continue;
      }

      results.total += 1;
      const fileName = path.basename(entry.entryName);
      const ext = path.extname(fileName).toLowerCase();
      const rawBuffer = entry.getData();

      // 1. Signature & Malware Check
      const scan = await securityHelper.scanFileForMalware(rawBuffer, fileName);
      if (!scan.isClean) {
        results.failed += 1;
        results.documents.push({ fileName, status: 'Failed', reason: `Security check: ${scan.threatFound}` });
        continue;
      }

      // 2. SHA-256 Deduplication
      const fileHash = securityHelper.computeFileHash(rawBuffer);
      const duplicate = await Document.findOne({ fileHash, tenantId, isDeleted: false });
      if (duplicate) {
        results.duplicatesSkipped += 1;
        results.documents.push({ fileName, status: 'Duplicate Skipped', existingDocumentId: duplicate._id });
        continue;
      }

      // 3. Save local file and upload
      const uniqueFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const destPath = path.join(uploadsDir, uniqueFileName);
      fs.writeFileSync(destPath, rawBuffer);

      const fakeMulterFile = {
        path: destPath,
        originalname: fileName,
        filename: uniqueFileName,
        size: rawBuffer.length,
        mimetype: ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg')
      };

      const uploadRes = await storageHelper.uploadToStorage(fakeMulterFile);

      // 4. Quick OCR & Metadata
      const fileMeta = manifest[fileName] || manifest[entry.entryName] || {};
      const aiMeta = await aiHelper.classifyAndExtractMetadata(fileName, fileName);

      const newDoc = new Document({
        name: fileMeta.name || path.basename(fileName, ext),
        originalFileName: fileName,
        fileType: ext.replace('.', '').toUpperCase(),
        mimeType: fakeMulterFile.mimetype,
        extension: ext,
        folderId: req.body.folderId || null,
        tenantId,
        uploadedBy: userId,
        fileSize: rawBuffer.length,
        storageUrl: uploadRes.url,
        fileHash,
        isMalwareScanned: true,
        scanResult: 'Clean',
        ingestionSource: 'Bulk ZIP Ingestion',
        documentType: fileMeta.documentType || aiMeta.documentType || 'Other',
        customerId: fileMeta.customerId || aiMeta.customerId || '',
        customerName: fileMeta.customerName || aiMeta.customerName || '',
        customerRef: fileMeta.customerRef || aiMeta.customerRef || '',
        facilityNumber: fileMeta.facilityNumber || aiMeta.facilityNumber || '',
        branch: fileMeta.branch || aiMeta.branch || '',
        documentDate: fileMeta.documentDate ? new Date(fileMeta.documentDate) : null,
        validationStatus: aiMeta.validationStatus || 'Valid',
        missingMandatoryFields: aiMeta.missingMandatoryFields || []
      });

      await newDoc.save();
      results.successful += 1;
      results.documents.push({
        documentId: newDoc._id,
        fileName,
        documentType: newDoc.documentType,
        status: 'Ingested'
      });
    }

    // Clean up uploaded zip file
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    return res.status(200).json({
      success: true,
      message: `Bulk ZIP Ingestion Complete: ${results.successful} ingested, ${results.duplicatesSkipped} duplicates skipped, ${results.failed} failed.`,
      summary: results
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/:companySlug/manager/api-keys
 * Generates an API Key for external systems (LOS, CBS, CRM)
 */
const generateApiKey = async (req, res, next) => {
  try {
    const tenantId = req.params.companySlug;
    const { systemName } = req.body;

    if (!systemName) {
      return res.status(400).json({ success: false, message: 'systemName is required (e.g. Loan Origination System)' });
    }

    const ApiKeyModel = req.tenantDb.models.ApiKey || req.tenantDb.model('ApiKey', apiKeySchema);

    const apiKey = `dms_live_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');

    const keyDoc = new ApiKeyModel({
      tenantId,
      systemName,
      apiKey,
      apiSecret,
      createdBy: req.user?.userId || null
    });

    await keyDoc.save();

    return res.status(201).json({
      success: true,
      message: 'API Key generated successfully. Save the Secret now; it will not be shown again.',
      data: {
        systemName: keyDoc.systemName,
        apiKey: keyDoc.apiKey,
        apiSecret: keyDoc.apiSecret,
        createdAt: keyDoc.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  ingestDocument,
  bulkZipIngest,
  generateApiKey
};
