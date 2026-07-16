const aiHelper = require('../helpers/ai.helper');

const summarizeDocument = async (req, res, next) => {
  try {
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

module.exports = {
  summarizeDocument,
  summarizeFolder
};
