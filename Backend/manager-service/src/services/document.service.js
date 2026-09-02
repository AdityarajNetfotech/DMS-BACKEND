const path = require('path');
const fs = require('fs');
const https = require('https');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const storageHelper = require('../helpers/storage.helper');
const storageService = require('./storage.service');
const activityService = require('./activity.service');

const extractTextFromFile = async (filePath, ext) => {
  try {
    if (!fs.existsSync(filePath)) {
      return '';
    }
    const rawBuffer = fs.readFileSync(filePath);
    const fileTypeUpper = ext.replace('.', '').toUpperCase();

    if (fileTypeUpper === 'PDF') {
      try {
        const pdfData = await pdfParse(rawBuffer);
        return pdfData.text || '';
      } catch (err) {
        console.error('PDF parsing failed:', err);
        return '';
      }
    } else if (fileTypeUpper === 'DOCX') {
      try {
        const docxData = await mammoth.extractRawText({ buffer: rawBuffer });
        return docxData.value || '';
      } catch (err) {
        console.error('DOCX parsing failed:', err);
        return '';
      }
    } else if (['XLSX', 'PPTX'].includes(fileTypeUpper)) {
      const matches = rawBuffer.toString('binary').match(/[ -~]{4,}/g);
      if (matches) {
        return matches
          .filter(str => {
            if (/^[0-9a-fA-F]{8,}$/.test(str)) return false;
            if (str.includes('<?xml') || str.includes('<Relationship') || str.includes('schema')) return false;
            return true;
          })
          .slice(0, 500)
          .join(' ')
          .replace(/\s+/g, ' ')
          .substring(0, 10000);
      }
    } else if (['TXT', 'CSV', 'JSON'].includes(fileTypeUpper)) {
      return rawBuffer.toString('utf8');
    }
  } catch (error) {
    console.error('Text extraction failed:', error);
  }
  return '';
};

const uploadDocument = async (req, folderId, file, name, description, tags = []) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const Version = req.Version;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const ext = path.extname(file.originalname);
  const docName = name || path.basename(file.originalname, ext);

  // Check if document with the same name exists in the folder
  let document = await Document.findOne({ name: docName, folderId: folderId || null, tenantId, isDeleted: false });

  if (document) {
    // If locked, reject modification
    if (document.isLocked) {
      throw new Error('Document is locked and cannot be updated.');
    }

    // Check storage limits first
    await storageService.checkAndIncrementStorage(req, file.size);

    // Save CURRENT document state as a history Version before updating
    const versionHistory = new Version({
      tenantId,
      documentId: document._id,
      versionNumber: document.versionNumber,
      fileName: document.originalFileName,
      fileSize: document.fileSize,
      storageUrl: document.storageUrl,
      uploadedBy: document.uploadedBy,
      comment: document.description || 'Backup version'
    });
    await versionHistory.save();

    // Extract text from the new file before it gets uploaded/moved
    let extractedText = '';
    if (file && file.path) {
      extractedText = await extractTextFromFile(file.path, ext);
    }

    // Upload the new file asset
    const uploadResult = await storageHelper.uploadToStorage(file);

    // Update document to new state
    document.versionNumber += 1;
    document.originalFileName = file.originalname;
    document.fileSize = file.size;
    document.storageUrl = uploadResult.url;
    document.uploadedBy = userId;
    document.extractedText = extractedText;
    if (description) document.description = description;
    if (tags && tags.length > 0) document.tags = tags;
    
    await document.save();

    await activityService.logActivity(req, 'Document Version Updated', 'Document', document._id);
    return { document, isNewVersion: true };
  } else {
    // Check storage limits
    await storageService.checkAndIncrementStorage(req, file.size);

    // Extract text from the new file before it gets uploaded/moved
    let extractedText = '';
    if (file && file.path) {
      extractedText = await extractTextFromFile(file.path, ext);
    }

    // Upload the file asset
    const uploadResult = await storageHelper.uploadToStorage(file);

    document = new Document({
      name: docName,
      originalFileName: file.originalname,
      fileType: ext.replace('.', '').toUpperCase(),
      mimeType: file.mimetype,
      extension: ext,
      folderId: folderId || null,
      tenantId,
      uploadedBy: userId,
      managerId: userId,
      fileSize: file.size,
      storageUrl: uploadResult.url,
      description,
      tags,
      extractedText,
      departmentId: req.user.departmentId || null
    });

    await document.save();

    // Update folder doc counter if inside a folder
    if (folderId) {
      await Folder.findByIdAndUpdate(folderId, { $inc: { totalDocuments: 1 } });
    }

    await activityService.logActivity(req, 'Document Uploaded', 'Document', document._id);
    return { document, isNewVersion: false };
  }
};

const updateDocumentDetails = async (req, docId, name, description, tags) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.uploadedBy = req.user.userId;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked and cannot be modified');

  if (name) doc.name = name;
  if (description) doc.description = description;
  if (tags) doc.tags = tags;

  await doc.save();
  await activityService.logActivity(req, 'Document Updated', 'Document', doc._id);
  return doc;
};

const toggleLockDocument = async (req, docId, isLocked) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.uploadedBy = req.user.userId;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');

  doc.isLocked = isLocked;
  doc.lockedBy = isLocked ? req.user.userId : null;
  await doc.save();

  const action = isLocked ? 'Document Locked' : 'Document Unlocked';
  await activityService.logActivity(req, action, 'Document', doc._id);
  return doc;
};

const toggleArchiveDocument = async (req, docId, isArchived) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.uploadedBy = req.user.userId;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked');

  doc.isArchived = isArchived;
  doc.archivedAt = isArchived ? new Date() : null;
  doc.status = isArchived ? 'Archived' : 'Active';
  await doc.save();

  const action = isArchived ? 'Document Archived' : 'Document Restored from Archive';
  await activityService.logActivity(req, action, 'Document', doc._id);
  return doc;
};

const toggleFavoriteDocument = async (req, docId, isFavorite) => {
  const Favorite = req.Favorite;
  const Document = req.Document;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.uploadedBy = req.user.userId;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');

  if (isFavorite) {
    await Favorite.findOneAndUpdate(
      { userId, documentId: doc._id, tenantId },
      {},
      { upsert: true }
    );
  } else {
    await Favorite.deleteOne({ userId, documentId: doc._id, tenantId });
  }

  return doc;
};

const softDeleteDocument = async (req, docId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: docId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.uploadedBy = req.user.userId;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked and cannot be deleted');

  doc.isDeleted = true;
  doc.deletedAt = new Date();
  await doc.save();

  if (doc.folderId) {
    await Folder.findByIdAndUpdate(doc.folderId, { $inc: { totalDocuments: -1 } });
  }

  const trash = new Trash({
    tenantId,
    resourceType: 'Document',
    resourceId: doc._id,
    deletedBy: userId,
    originalParentId: doc.folderId
  });
  await trash.save();

  await activityService.logActivity(req, 'Document Deleted', 'Document', doc._id);
};

const restoreDocument = async (req, docId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;

  const query = { _id: docId, tenantId, isDeleted: true };
  if (req.user.role !== 'Tenant Admin') {
    query.uploadedBy = req.user.userId;
  }

  const doc = await Document.findOne(query);
  if (!doc) throw new Error('Document not found in Trash');

  // Find or create "Trash" folder at root level (safely handling soft-deleted duplicates)
  let trashFolder = await Folder.findOne({ tenantId, name: 'Trash', parentFolder: null, departmentId: req.user.departmentId || null });
  if (!trashFolder) {
    trashFolder = new Folder({
      name: 'Trash',
      parentFolder: null,
      tenantId,
      createdBy: req.user.userId,
      isDeleted: false,
      departmentId: req.user.departmentId || null
    });
    await trashFolder.save();
    await activityService.logActivity(req, 'Folder Created', 'Folder', trashFolder._id);
  } else if (trashFolder.isDeleted) {
    trashFolder.isDeleted = false;
    trashFolder.deletedAt = null;
    await trashFolder.save();
  }

  doc.folderId = trashFolder._id;
  doc.isDeleted = false;
  doc.deletedAt = null;
  await doc.save();

  await Folder.findByIdAndUpdate(trashFolder._id, { $inc: { totalDocuments: 1 } });

  await Trash.deleteOne({ tenantId, resourceType: 'Document', resourceId: doc._id });

  await activityService.logActivity(req, 'Document Restored', 'Document', doc._id);
};

const permanentlyDeleteDocument = async (req, docId) => {
  const Document = req.Document;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: true });
  if (!doc) throw new Error('Document not found in Trash');

  // Decrement storage
  await storageService.decrementStorage(req, doc.fileSize);

  // Delete physical storage asset
  await storageHelper.deleteFromStorage(doc.storageUrl);

  // Clean relations
  await req.Version.deleteMany({ documentId: doc._id });
  await req.Favorite.deleteMany({ documentId: doc._id });
  await req.Share.deleteMany({ documentId: doc._id });

  await Document.findByIdAndDelete(doc._id);
  await Trash.deleteOne({ tenantId, resourceType: 'Document', resourceId: doc._id });

  await activityService.logActivity(req, 'Document Permanently Deleted', 'Document', doc._id);
};

const copyDocument = async (req, docId, targetFolderId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');

  // Storage check
  await storageService.checkAndIncrementStorage(req, doc.fileSize);

  // For simplicity, copy points to the same underlying physical asset but tracks separately.
  // In a full system, you could duplicate the physical file. Pointing to the same URL is fine.
  const newDoc = new Document({
    name: doc.name + ' - Copy',
    originalFileName: doc.originalFileName,
    fileType: doc.fileType,
    mimeType: doc.mimeType,
    extension: doc.extension,
    folderId: targetFolderId || null,
    tenantId,
    uploadedBy: userId,
    managerId: userId,
    fileSize: doc.fileSize,
    storageUrl: doc.storageUrl,
    description: doc.description,
    tags: doc.tags
  });

  await newDoc.save();

  if (targetFolderId) {
    await Folder.findByIdAndUpdate(targetFolderId, { $inc: { totalDocuments: 1 } });
  }

  await activityService.logActivity(req, 'Document Copied', 'Document', newDoc._id);
  return newDoc;
};

const moveDocument = async (req, docId, targetFolderId) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');
  if (doc.isLocked) throw new Error('Document is locked');

  const oldFolderId = doc.folderId;
  doc.folderId = targetFolderId || null;
  await doc.save();

  // Update folder counters
  if (oldFolderId) {
    await Folder.findByIdAndUpdate(oldFolderId, { $inc: { totalDocuments: -1 } });
  }
  if (targetFolderId) {
    await Folder.findByIdAndUpdate(targetFolderId, { $inc: { totalDocuments: 1 } });
  }

  await activityService.logActivity(req, 'Document Moved', 'Document', doc._id);
  return doc;
};

const escapeXml = (unsafe) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

const createWordDocxBuffer = (originalName, textContent) => {
  const zip = new AdmZip();
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const escapedText = escapeXml(textContent);
  const paragraphs = escapedText.split('\n').map(line => 
    `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`
  ).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
        <w:t>CONVERTED DOCUMENT</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:i/></w:rPr>
        <w:t>Original File: ${escapeXml(originalName)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:i/></w:rPr>
        <w:t>Converted On: ${escapeXml(new Date().toLocaleString())}</w:t>
      </w:r>
    </w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    ${paragraphs}
  </w:body>
</w:document>`;
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml));
  zip.addFile('_rels/.rels', Buffer.from(relsXml));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  return zip.toBuffer();
};

const createExcelXlsxBuffer = (originalName, textContent) => {
  const zip = new AdmZip();
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const escapedText = escapeXml(textContent);
  const rows = escapedText.split('\n').map((line, idx) => 
    `<row r="${idx + 5}"><c r="A${idx + 5}" t="inlineStr"><is><t>${line}</t></is></c></row>`
  ).join('');
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>CONVERTED SPREADSHEET</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Original File: ${escapeXml(originalName)}</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Converted On: ${escapeXml(new Date().toLocaleString())}</t></is></c>
    </row>
    <row r="4">
      <c r="A4" t="inlineStr"><is><t></t></is></c>
    </row>
    ${rows}
  </sheetData>
</worksheet>`;
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml));
  zip.addFile('_rels/.rels', Buffer.from(relsXml));
  zip.addFile('xl/workbook.xml', Buffer.from(workbookXml));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRelsXml));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet1Xml));
  return zip.toBuffer();
};

const createPptxBuffer = (originalName, textContent) => {
  const zip = new AdmZip();
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
  const presentationRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;
  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
  const escapedText = escapeXml(textContent);
  const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <p:bodyPr/>
          <p:lstStyle/>
          <p:p>
            <p:r>
              <p:rPr lang="en-US" sz="4400"/>
              <p:t>Converted Presentation</p:t>
            </p:r>
          </p:p>
          <p:p>
            <p:r>
              <p:rPr lang="en-US" sz="2000"/>
              <p:t>Original File: ${escapeXml(originalName)}</p:t>
            </p:r>
          </p:p>
          <p:p>
            <p:r>
              <p:rPr lang="en-US" sz="1600"/>
              <p:t>${escapeXml(escapedText.substring(0, 1000))}</p:t>
            </p:r>
          </p:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml));
  zip.addFile('_rels/.rels', Buffer.from(relsXml));
  zip.addFile('ppt/presentation.xml', Buffer.from(presentationXml));
  zip.addFile('ppt/_rels/presentation.xml.rels', Buffer.from(presentationRelsXml));
  zip.addFile('ppt/slides/slide1.xml', Buffer.from(slide1Xml));
  return zip.toBuffer();
};

const fetchRemoteFileBuffer = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file from remote: Status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const convertDocument = async (req, docId, targetFormat) => {
  const Document = req.Document;
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');

  // Load existing file content if possible, otherwise use a placeholder text
  let rawBuffer = null;
  if (doc.storageUrl.includes('/uploads/')) {
    const parts = doc.storageUrl.split('/uploads/');
    const fileName = parts[parts.length - 1];
    const filePath = path.join(__dirname, '../../uploads', fileName);
    if (fs.existsSync(filePath)) {
      try {
        rawBuffer = fs.readFileSync(filePath);
      } catch (err) {
        console.error('Failed to read local file:', err);
      }
    }
  } else if (doc.storageUrl.startsWith('/uploads')) {
    const filePath = path.join(__dirname, '../../', doc.storageUrl);
    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size < 10 * 1024 * 1024) { // Only read files smaller than 10MB
          rawBuffer = fs.readFileSync(filePath);
        }
      } catch (err) {
        console.error('Failed to read local file:', err);
      }
    }
  } else if (doc.storageUrl.startsWith('http')) {
    try {
      rawBuffer = await fetchRemoteFileBuffer(doc.storageUrl);
    } catch (err) {
      console.error('Failed to download remote file for conversion:', err);
    }
  }

  let originalText = `Document: ${doc.name}`;
  if (rawBuffer) {
    const fileTypeUpper = doc.fileType.toUpperCase();
    if (fileTypeUpper === 'PDF') {
      try {
        const pdfData = await pdfParse(rawBuffer);
        originalText = pdfData.text || `Document: ${doc.name}`;
      } catch (err) {
        console.error('PDF parsing failed:', err);
      }
    } else if (fileTypeUpper === 'DOCX') {
      try {
        const docxData = await mammoth.extractRawText({ buffer: rawBuffer });
        originalText = docxData.value || `Document: ${doc.name}`;
      } catch (err) {
        console.error('DOCX parsing failed:', err);
      }
    } else if (['XLSX', 'PPTX'].includes(fileTypeUpper)) {
      // For spreadsheet/slides, fall back to printable strings extraction
      const matches = rawBuffer.toString('binary').match(/[ -~]{4,}/g);
      if (matches) {
        originalText = matches
          .filter(str => {
            if (/^[0-9a-fA-F]{8,}$/.test(str)) return false;
            if (str.includes('<?xml') || str.includes('<Relationship') || str.includes('schema')) return false;
            return true;
          })
          .slice(0, 150)
          .join(' ')
          .replace(/\s+/g, ' ')
          .substring(0, 5000);
      }
    } else {
      // Normal plain text files
      originalText = rawBuffer.toString('utf8');
    }
  }

  // Create temporary filename
  const convertedName = `${path.basename(doc.name, path.extname(doc.name))}.${targetFormat.toLowerCase()}`;
  const tempDir = path.join(__dirname, '../../uploads/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempFilePath = path.join(tempDir, `${Date.now()}_${convertedName}`);

  let fileContent = '';
  let mimeType = 'text/plain';

  if (targetFormat === 'PDF') {
    mimeType = 'application/pdf';
    // Clean text for basic PDF format
    const cleanedText = originalText.replace(/[\(\)\\]/g, '\\$&').replace(/\n/g, ') Tj T* (');
    const pdfBody = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 595.275 841.889] /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length ${cleanedText.length + 100} >>\nstream\nBT\n/F1 12 Tf\n30 800 Td\n15 TL\n(${cleanedText}) Tj\nET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000111 00000 n\n0000000250 00000 n\n0000000321 00000 n\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n420\n%%EOF`;
    fileContent = Buffer.from(pdfBody);
  } else if (targetFormat === 'HTML') {
    mimeType = 'text/html';
    fileContent = `<!DOCTYPE html>
<html>
<head>
  <title>${doc.name} - Converted</title>
  <style>
    body { font-family: sans-serif; padding: 40px; line-height: 1.6; color: #333; }
    h1 { color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    pre { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${doc.name}</h1>
  <p><strong>Original File:</strong> ${doc.originalFileName} (${doc.fileType})</p>
  <p><strong>Converted On:</strong> ${new Date().toLocaleString()}</p>
  <hr/>
  <pre>${originalText}</pre>
</body>
</html>`;
  } else if (targetFormat === 'DOCX') {
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    fileContent = createWordDocxBuffer(doc.originalFileName, originalText);
  } else if (targetFormat === 'XLSX') {
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileContent = createExcelXlsxBuffer(doc.originalFileName, originalText);
  } else if (targetFormat === 'PPTX') {
    mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    fileContent = createPptxBuffer(doc.originalFileName, originalText);
  } else {
    // Default to TXT
    mimeType = 'text/plain';
    fileContent = `--- CONVERTED DOCUMENT ---
Original Name: ${doc.originalFileName}
Original Type: ${doc.fileType}
Converted At: ${new Date().toLocaleString()}
-----------------------------------

${originalText}`;
  }

  fs.writeFileSync(tempFilePath, fileContent);

  // Upload the temp file to storage (local or cloudinary)
  const mockFile = {
    path: tempFilePath,
    originalname: convertedName,
    size: Buffer.byteLength(fileContent),
    mimetype: mimeType
  };

  const uploadResult = await storageHelper.uploadToStorage(mockFile);

  // Increment storage limits
  await storageService.checkAndIncrementStorage(req, mockFile.size);

  const convertedDoc = new Document({
    name: `${doc.name} (${targetFormat})`,
    originalFileName: convertedName,
    fileType: targetFormat,
    mimeType: mimeType,
    extension: `.${targetFormat.toLowerCase()}`,
    folderId: doc.folderId,
    tenantId,
    uploadedBy: userId,
    managerId: userId,
    fileSize: mockFile.size,
    storageUrl: uploadResult.url,
    description: `Converted from ${doc.originalFileName} to ${targetFormat}`,
    tags: [...doc.tags, 'converted'],
    extractedText: originalText,
    departmentId: doc.departmentId
  });

  await convertedDoc.save();

  if (doc.folderId) {
    await Folder.findByIdAndUpdate(doc.folderId, { $inc: { totalDocuments: 1 } });
  }

  await activityService.logActivity(req, `Document Converted to ${targetFormat}`, 'Document', convertedDoc._id);
  return convertedDoc;
};

const restoreVersion = async (req, docId, versionId) => {
  const Document = req.Document;
  const Version = req.Version;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');

  if (doc.isLocked) {
    throw new Error('Document is locked and cannot be restored.');
  }

  const oldVersion = await Version.findOne({ _id: versionId, documentId: docId, tenantId });
  if (!oldVersion) throw new Error('Historical version not found');

  const currentVersionBackup = new Version({
    tenantId,
    documentId: doc._id,
    versionNumber: doc.versionNumber,
    fileName: doc.originalFileName,
    fileSize: doc.fileSize,
    storageUrl: doc.storageUrl,
    uploadedBy: doc.uploadedBy,
    comment: `Before restoring to version v${oldVersion.versionNumber}.0`
  });
  await currentVersionBackup.save();

  doc.versionNumber += 1;
  doc.originalFileName = oldVersion.fileName;
  doc.fileSize = oldVersion.fileSize;
  doc.storageUrl = oldVersion.storageUrl;
  doc.uploadedBy = userId;
  doc.description = `Restored to version v${oldVersion.versionNumber}.0`;
  
  await doc.save();

  await activityService.logActivity(req, 'Document Version Restored', 'Document', doc._id);
  return doc;
};

/**
 * Download a file from a remote URL into a temp file, returning the temp path.
 */
const downloadToTemp = (url) => {
  return new Promise((resolve, reject) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `dms_reextract_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const file = fs.createWriteStream(tmpFile);
    const protocol = url.startsWith('https') ? require('https') : require('http');
    protocol.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(tmpFile)));
    }).on('error', (err) => {
      fs.unlink(tmpFile, () => {});
      reject(err);
    });
  });
};

/**
 * Re-extract text for a single document and save it.
 * Works for both local and Cloudinary-stored files.
 */
const reExtractTextForDocument = async (req, docId) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
  if (!doc) throw new Error('Document not found');

  const ext = doc.extension || path.extname(doc.originalFileName);

  let extractedText = '';

  if (doc.storageUrl.startsWith('/uploads')) {
    // Local file
    const filePath = path.join(__dirname, '../../', doc.storageUrl);
    if (fs.existsSync(filePath)) {
      extractedText = await extractTextFromFile(filePath, ext);
    }
  } else {
    // Remote (Cloudinary) — download to temp, extract, then clean up
    let tmpPath = null;
    try {
      tmpPath = await downloadToTemp(doc.storageUrl);
      extractedText = await extractTextFromFile(tmpPath, ext);
    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) {
        fs.unlink(tmpPath, () => {});
      }
    }
  }

  doc.extractedText = extractedText;
  await doc.save();
  return { _id: doc._id, name: doc.name, extractedText: extractedText.substring(0, 200) };
};

/**
 * Backfill extractedText for ALL documents that currently have no extracted text.
 * Processes in batches to avoid memory issues.
 */
const backfillAllExtractedText = async (req) => {
  const Document = req.Document;
  const tenantId = req.user.companySlug;

  const filter = { tenantId, isDeleted: false, $or: [{ extractedText: '' }, { extractedText: { $exists: false } }] };
  const total = await Document.countDocuments(filter);
  const docs = await Document.find(filter, '_id name originalFileName extension storageUrl').limit(100);

  let processed = 0;
  let failed = 0;
  const results = [];

  for (const doc of docs) {
    try {
      const ext = doc.extension || path.extname(doc.originalFileName);
      let extractedText = '';

      if (doc.storageUrl.startsWith('/uploads')) {
        const filePath = path.join(__dirname, '../../', doc.storageUrl);
        if (fs.existsSync(filePath)) {
          extractedText = await extractTextFromFile(filePath, ext);
        }
      } else {
        let tmpPath = null;
        try {
          tmpPath = await downloadToTemp(doc.storageUrl);
          extractedText = await extractTextFromFile(tmpPath, ext);
        } finally {
          if (tmpPath && fs.existsSync(tmpPath)) {
            fs.unlink(tmpPath, () => {});
          }
        }
      }

      await Document.updateOne({ _id: doc._id }, { $set: { extractedText } });
      processed++;
      results.push({ _id: doc._id, name: doc.name, status: 'ok', chars: extractedText.length });
    } catch (err) {
      failed++;
      results.push({ _id: doc._id, name: doc.name, status: 'error', error: err.message });
    }
  }

  return { total, processed, failed, results };
};

module.exports = {
  uploadDocument,
  updateDocumentDetails,
  toggleLockDocument,
  toggleArchiveDocument,
  toggleFavoriteDocument,
  softDeleteDocument,
  restoreDocument,
  permanentlyDeleteDocument,
  copyDocument,
  moveDocument,
  convertDocument,
  restoreVersion,
  reExtractTextForDocument,
  backfillAllExtractedText
};
