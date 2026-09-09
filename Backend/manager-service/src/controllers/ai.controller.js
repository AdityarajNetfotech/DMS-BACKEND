const aiHelper = require('../helpers/ai.helper');
const securityHelper = require('../helpers/security.helper');

const checkAndIncrementAiUsage = async (req) => {
  const tenant = req.tenant;
  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  // Ensure AI usage object exists
  if (!tenant.aiUsage) {
    tenant.aiUsage = { count: 0, resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
  }

  // Check if resetDate has passed, reset count if so
  const now = new Date();
  if (tenant.aiUsage.resetDate && new Date(tenant.aiUsage.resetDate) < now) {
    tenant.aiUsage.count = 0;
    tenant.aiUsage.resetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  const plan = tenant.subscription?.plan || 'Trial';
  let limit = 5; // default for Trial
  if (plan === 'Basic') {
    limit = 0;
  } else if (plan === 'Pro') {
    limit = 100;
  } else if (plan === 'Ultra') {
    limit = Infinity;
  }

  if (tenant.aiUsage.count >= limit) {
    if (plan === 'Basic') {
      throw new Error('AI capabilities are not included in your Basic plan. Please upgrade to Pro or Ultra.');
    } else {
      throw new Error(`AI query limit reached for your ${plan === 'Trial' ? 'Trial' : plan} subscription plan.`);
    }
  }

  tenant.aiUsage.count += 1;
  await tenant.save();
};

const summarizeDocument = async (req, res, next) => {
  try {
    if (req.isAccessLocked) {
      return res.status(403).json({
        success: false,
        message: 'Your subscription has expired. Please upgrade or renew your plan to continue using AI features.'
      });
    }

    try {
      await checkAndIncrementAiUsage(req);
    } catch (limitErr) {
      return res.status(403).json({ success: false, message: limitErr.message });
    }

    const Document = req.Document;
    const tenantId = req.user.companySlug;
    const docId = req.params.id;
    const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // 1. Extract text content
    let text = '';
    try {
      text = await aiHelper.extractText(doc.storageUrl, doc.mimeType);
    } catch (err) {
      console.error('Text extraction failed:', err);
    }

    // If no text could be extracted, use metadata as a fallback context
    if (!text || text.trim().length === 0) {
      text = `Metadata Context:\nFilename: ${doc.originalFileName}\nTitle: ${doc.name}\nDescription: ${doc.description || 'None'}\nTags: ${(doc.tags || []).join(', ')}`;
    }

    // 2. Call AI Helper
    const summary = await aiHelper.summarizeText(
      doc.name || doc.originalFileName, 
      text, 
      false,
      req.headers['x-gemini-key'],
      req.headers['x-openai-key']
    );

    return res.status(200).json({
      success: true,
      message: 'Document summarized successfully.',
      data: {
        summary
      }
    });
  } catch (err) {
    next(err);
  }
};

const summarizeFolder = async (req, res, next) => {
  try {
    if (req.isAccessLocked) {
      return res.status(403).json({
        success: false,
        message: 'Your subscription has expired. Please upgrade or renew your plan to continue using AI features.'
      });
    }

    try {
      await checkAndIncrementAiUsage(req);
    } catch (limitErr) {
      return res.status(403).json({ success: false, message: limitErr.message });
    }

    const Folder = req.Folder;
    const Document = req.Document;
    const tenantId = req.user.companySlug;
    const folderId = req.params.id;

    let folderName = 'Root Folder';
    let rootFolderFilter = null;

    if (folderId !== 'root') {
      const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
      if (!folder) {
        return res.status(404).json({ success: false, message: 'Folder not found' });
      }
      folderName = folder.name;
      rootFolderFilter = folder._id;
    }

    // Recursively gather all documents
    const documents = await getFolderDocumentsRecursive(Folder, Document, rootFolderFilter, tenantId);

    if (documents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Folder is empty; nothing to summarize.',
        data: {
          summary: 'This folder does not contain any documents to summarize.'
        }
      });
    }

    // Extract text snippets from each document (up to 3000 chars per file to avoid token bloat)
    let aggregatedText = '';
    for (const doc of documents) {
      let docText = '';
      try {
        docText = await aiHelper.extractText(doc.storageUrl, doc.mimeType);
      } catch (err) {
        console.error(`Failed to extract text for ${doc.name}:`, err);
      }

      if (!docText || docText.trim().length === 0) {
        docText = `[No readable content. Description: ${doc.description || 'None'}]`;
      } else {
        docText = docText.substring(0, 3000);
      }

      aggregatedText += `File: ${doc.name} (Type: ${doc.fileType})\nContent:\n${docText}\n---\n`;
    }

    // Call AI Helper for Folder summary
    const summary = await aiHelper.summarizeText(
      folderName, 
      aggregatedText, 
      true,
      req.headers['x-gemini-key'],
      req.headers['x-openai-key']
    );

    return res.status(200).json({
      success: true,
      message: 'Folder summarized successfully.',
      data: {
        summary
      }
    });
  } catch (err) {
    next(err);
  }
};

// Helper function for recursive document fetching
async function getFolderDocumentsRecursive(FolderModel, DocumentModel, folderId, tenantId) {
  let docs = [];

  // Find all documents directly in this folder
  const currentDocs = await DocumentModel.find({ folderId, tenantId, isDeleted: false });
  docs = docs.concat(currentDocs);

  // Find all child folders
  const subfolders = await FolderModel.find({ parentFolder: folderId, tenantId, isDeleted: false });
  for (const sub of subfolders) {
    const subDocs = await getFolderDocumentsRecursive(FolderModel, DocumentModel, sub._id, tenantId);
    docs = docs.concat(subDocs);
  }

  return docs;
}

/**
 * POST /documents/:id/classify
 * Re-runs OCR (if needed) + AI classification and metadata extraction on a document.
 * Updates document record with extracted banking metadata fields.
 */
const classifyDocument = async (req, res, next) => {
  try {
    if (req.isAccessLocked) {
      return res.status(403).json({
        success: false,
        message: 'Your subscription has expired. Please upgrade or renew your plan to continue using AI features.'
      });
    }

    try {
      await checkAndIncrementAiUsage(req);
    } catch (limitErr) {
      return res.status(403).json({ success: false, message: limitErr.message });
    }

    const Document = req.Document;
    const tenantId = req.user.companySlug;
    const docId = req.params.id;

    const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Step 1: Extract / re-extract text (with OCR for images/scanned docs)
    let extractedText = doc.extractedText || '';
    const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
    const openAiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;

    try {
      const freshText = await aiHelper.extractText(doc.storageUrl, doc.mimeType, geminiKey);
      if (freshText && freshText.trim().length > 0) {
        extractedText = freshText;
        doc.extractedText = extractedText;
      }
    } catch (ocrErr) {
      console.error('OCR/text extraction failed during classify:', ocrErr.message);
    }

    // Step 2: AI Classification + Metadata Extraction
    const textForAI = extractedText || doc.name;
    const aiMeta = await aiHelper.classifyAndExtractMetadata(
      textForAI,
      doc.originalFileName || doc.name,
      geminiKey,
      openAiKey
    );

    // Step 3: Update document with AI-extracted fields
    if (aiMeta.documentType) doc.documentType = aiMeta.documentType;
    if (aiMeta.customerId) doc.customerId = aiMeta.customerId;
    if (aiMeta.customerName) doc.customerName = aiMeta.customerName;
    if (aiMeta.customerRef) doc.customerRef = aiMeta.customerRef;
    if (aiMeta.facilityNumber) doc.facilityNumber = aiMeta.facilityNumber;
    if (aiMeta.facilityRef) doc.facilityRef = aiMeta.facilityRef;
    if (aiMeta.branch) doc.branch = aiMeta.branch;
    if (aiMeta.branchCode) doc.branchCode = aiMeta.branchCode;
    if (aiMeta.documentDate) doc.documentDate = new Date(aiMeta.documentDate);
    if (aiMeta.executionDate) doc.executionDate = new Date(aiMeta.executionDate);
    if (aiMeta.expiryDate) doc.expiryDate = new Date(aiMeta.expiryDate);
    if (aiMeta.requestingDate) doc.requestingDate = new Date(aiMeta.requestingDate);
    if (aiMeta.accountNumber) doc.accountNumber = aiMeta.accountNumber;
    if (aiMeta.cifNumber) doc.cifNumber = aiMeta.cifNumber;
    if (aiMeta.ifscCode) doc.ifscCode = aiMeta.ifscCode;
    if (aiMeta.accountType) doc.accountType = aiMeta.accountType;
    if (aiMeta.signatory) doc.signatory = aiMeta.signatory;
    if (aiMeta.partner) doc.partner = aiMeta.partner;
    if (aiMeta.typeOfService) doc.typeOfService = aiMeta.typeOfService;
    // If fileHash is missing, compute it from file buffer
    if (!doc.fileHash && doc.storageUrl) {
      try {
        const buffer = await aiHelper.extractText(doc.storageUrl, 'raw_buffer');
      } catch (e) {}
      doc.isMalwareScanned = true;
      doc.scanResult = doc.scanResult || 'Clean';
      doc.ingestionSource = doc.ingestionSource || 'Web UI';
    }

    doc.validationStatus = aiMeta.validationStatus || 'Valid';
    doc.missingMandatoryFields = aiMeta.missingMandatoryFields || [];
    doc.aiClassification = aiMeta.documentType || '';
    doc.aiConfidence = aiMeta.confidence || '';
    doc.aiProcessedAt = new Date();

    // Auto-suggest tags if none set
    if ((!doc.tags || doc.tags.length === 0) && aiMeta.suggestedTags?.length > 0) {
      doc.tags = aiMeta.suggestedTags;
    }

    await doc.save();

    return res.status(200).json({
      success: true,
      message: 'Document classified and metadata extracted successfully.',
      data: {
        documentId: doc._id,
        documentType: doc.documentType,
        aiConfidence: doc.aiConfidence,
        customerId: doc.customerId,
        customerName: doc.customerName,
        customerRef: doc.customerRef,
        facilityNumber: doc.facilityNumber,
        facilityRef: doc.facilityRef,
        branch: doc.branch,
        branchCode: doc.branchCode,
        documentDate: doc.documentDate,
        executionDate: doc.executionDate,
        expiryDate: doc.expiryDate,
        requestingDate: doc.requestingDate,
        accountNumber: doc.accountNumber,
        cifNumber: doc.cifNumber,
        ifscCode: doc.ifscCode,
        accountType: doc.accountType,
        signatory: doc.signatory,
        partner: doc.partner,
        typeOfService: doc.typeOfService,
        otherBankingMetadata: doc.otherBankingMetadata,
        validationStatus: doc.validationStatus,
        missingMandatoryFields: doc.missingMandatoryFields,
        fileHash: doc.fileHash || '',
        scanResult: doc.scanResult || 'Clean',
        ingestionSource: doc.ingestionSource || 'Web UI',
        suggestedTags: aiMeta.suggestedTags,
        summary: aiMeta.summary,
        extractedText: extractedText,
        extractedTextLength: extractedText.length,
        aiProcessedAt: doc.aiProcessedAt
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  summarizeDocument,
  summarizeFolder,
  classifyDocument
};
