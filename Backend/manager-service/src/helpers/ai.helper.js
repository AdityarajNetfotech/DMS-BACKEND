const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const cloudinaryHelper = require('./cloudinary.helper');

/**
 * Reads a local or remote file into a buffer
 */
async function getFileBuffer(storageUrl) {
  if (storageUrl.includes('/uploads/')) {
    const parts = storageUrl.split('/uploads/');
    const fileName = parts[parts.length - 1];
    const filePath = path.join(__dirname, '../../uploads', fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Local file not found at ${filePath}`);
    return fs.readFileSync(filePath);
  } else if (storageUrl.startsWith('/uploads')) {
    const filePath = path.join(__dirname, '../../', storageUrl);
    if (!fs.existsSync(filePath)) throw new Error(`Local file not found at ${filePath}`);
    return fs.readFileSync(filePath);
  } else {
    const buffer = await cloudinaryHelper.fetchRemoteBuffer(storageUrl);
    if (!buffer) throw new Error('Failed to download remote file');
    return buffer;
  }
}

/**
 * Performs OCR on an image or scanned PDF buffer.
 * Tries Gemini Vision first, then falls back to OpenAI GPT-4o-mini Vision.
 * Supports: image/jpeg, image/png, image/tiff, image/webp, application/pdf
 * Returns extracted text string.
 */
async function ocrWithGemini(buffer, mimeType, geminiKey, openAiKey) {
  const base64Data = buffer.toString('base64');
  const gKey = geminiKey || process.env.GEMINI_API_KEY;
  const oKey = openAiKey || process.env.OPENAI_API_KEY;

  // 1. Try Gemini Vision (support image & PDF)
  if (gKey) {
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Data } },
                  { text: 'Extract ALL text, labels, numbers, and key-value pairs from this document image accurately. Pay special attention to banking details: Account No, CIF No, IFSC Code, Customer Name, Branch Name/Code, Dates, Account Type, Signatures, and all printed/written text. Preserve structure and return all extracted text.' }
                ]
              }]
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 5) {
            console.log(`Gemini OCR (${model}) succeeded. Extracted ${text.length} chars.`);
            return text.trim();
          }
        } else {
          const errText = await response.text();
          console.warn(`Gemini OCR (${model}) returned status ${response.status}:`, errText);
        }
      } catch (err) {
        console.error(`Gemini OCR (${model}) error:`, err.message);
      }
    }
  }

  // 2. OpenAI GPT-4o-mini Vision Fallback (for image types)
  if (oKey && !mimeType.includes('pdf')) {
    try {
      console.log('Attempting OpenAI GPT-4o-mini Vision OCR fallback...');
      const mediaType = mimeType || 'image/jpeg';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${oKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract ALL text from this document image exactly as it appears. Return only the raw extracted text, no explanations.' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mediaType};base64,${base64Data}`
                  }
                }
              ]
            }
          ],
          max_tokens: 3000
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim().length > 5) {
          console.log(`OpenAI Vision OCR succeeded. Extracted ${text.length} chars.`);
          return text.trim();
        }
      } else {
        const errText = await response.text();
        console.warn('OpenAI Vision OCR returned status:', response.status, errText);
      }
    } catch (err) {
      console.error('OpenAI Vision OCR fallback error:', err.message);
    }
  }

  return '';
}

/**
 * Extracts text from local or remote file.
 * For image files and scanned/image-based PDFs, falls back to Gemini Vision OCR.
 */
async function extractText(storageUrl, mimeType, geminiKey) {
  try {
    const buffer = await getFileBuffer(storageUrl);

    const typeLower = (mimeType || '').toLowerCase();
    const urlWithoutQuery = storageUrl.split('?')[0];
    const ext = path.extname(urlWithoutQuery || '').toLowerCase();

    // --- PDF ---
    if (typeLower.includes('pdf') || ext === '.pdf') {
      try {
        const parsed = await pdf(buffer);
        const text = parsed.text || '';
        // If meaningful text found, it's a digital PDF
        if (text.trim().length > 50) return text;
        // Scanned/image-based PDF — use Gemini Vision OCR
        console.log('PDF appears scanned/image-based. Using Gemini OCR...');
        return await ocrWithGemini(buffer, 'application/pdf', geminiKey);
      } catch (err) {
        console.error('PDF parse failed, attempting Gemini OCR:', err.message);
        return await ocrWithGemini(buffer, 'application/pdf', geminiKey);
      }
    }

    // --- DOCX / DOC ---
    if (
      typeLower.includes('word') ||
      typeLower.includes('officedocument.wordprocessingml') ||
      ext === '.docx' || ext === '.doc'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }

    // --- Plain text formats ---
    if (
      typeLower.includes('text') || typeLower.includes('json') ||
      typeLower.includes('javascript') || typeLower.includes('csv') ||
      ext === '.txt' || ext === '.md' || ext === '.json' ||
      ext === '.csv' || ext === '.js' || ext === '.html'
    ) {
      return buffer.toString('utf8');
    }

    // --- Image files (JPG, PNG, TIFF, etc.) — Gemini Vision OCR ---
    const imageExts = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.bmp'];
    const isImage = imageMimeTypes(typeLower) || imageExts.includes(ext);
    if (isImage) {
      const imgMime = resolveImageMime(typeLower, ext);
      console.log(`Image file detected (${ext}). Performing Gemini Vision OCR...`);
      return await ocrWithGemini(buffer, imgMime, geminiKey);
    }

    return '';
  } catch (error) {
    console.error('Error during text extraction:', error);
    return '';
  }
}

function imageMimeTypes(typeLower) {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif', 'image/webp', 'image/bmp']
    .some(m => typeLower.includes(m));
}

function resolveImageMime(typeLower, ext) {
  if (typeLower.includes('png') || ext === '.png') return 'image/png';
  if (typeLower.includes('tiff') || ext === '.tiff' || ext === '.tif') return 'image/tiff';
  if (typeLower.includes('webp') || ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Uses Gemini (or OpenAI fallback) to classify document type and extract banking metadata,
 * including mandatory-field validation and structured banking fields.
 */
async function classifyAndExtractMetadata(text, fileName, geminiKey, openAiKey) {
  const trimmedText = text.length > 15000 ? text.substring(0, 15000) + '\n[Content truncated...]' : text;

  const prompt = `You are an expert banking document analyst AI. Analyze the following document text and filename, then extract structured banking metadata with high accuracy.

Filename: "${fileName}"
Document Content:
${trimmedText}

Return ONLY a valid JSON object (no markdown, no backticks, no code fences) with these exact fields:
{
  "documentType": "one of: Loan Agreement, KYC Document, Bank Passbook, Sanction Letter, Facility Agreement, Mortgage Deed, Guarantee, Insurance Policy, Board Resolution, Memorandum of Understanding, Non-Disclosure Agreement, Employment Contract, Invoice, Purchase Order, Financial Statement, Audit Report, Regulatory Filing, Correspondence, Other",
  "confidence": "High, Medium, or Low",
  "customerId": "Customer ID, CIF Number, or identification number if found, else empty string",
  "customerName": "Full name of the customer, borrower, or account holder if found, else empty string",
  "customerRef": "Combined customer reference (e.g. John Doe / ACC-12345) if found, else empty string",
  "facilityNumber": "Facility / Loan / Account / Reference number if found, else empty string",
  "facilityRef": "Loan ID or Facility identifier if found, else empty string",
  "branch": "Branch name or location (e.g. ADITYAPUR SME, Main Branch) if found, else empty string",
  "branchCode": "Branch code or identifier if found, else empty string",
  "documentDate": "Date of the document / Date of issuing / Execution date in YYYY-MM-DD format if found, else null",
  "executionDate": "Date of signing / execution in YYYY-MM-DD format if found, else null",
  "expiryDate": "Expiry, validity, or maturity date in YYYY-MM-DD format if found, else null",
  "accountNumber": "Bank account number if found, else empty string",
  "cifNumber": "CIF number if found, else empty string",
  "ifscCode": "IFSC code / Bank routing code if found, else empty string",
  "accountType": "Account type (e.g. Savings, Current, Jan Dhan, Term Loan) if found, else empty string",
  "signatory": "Name of authorized signatory, branch manager, or signing officer if found, else empty string",
  "partner": "Counterparty, partner bank, merchant, or institution name if found, else empty string",
  "typeOfService": "Service or facility product described in the document if applicable, else empty string",
  "summary": "one sentence summarizing this document",
  "suggestedTags": ["up to 5 relevant tags for this document"],
  "otherBankingMetadata": {
    "fatherOrSpouseName": "if found, else empty string",
    "jointAccountHolder": "if found, else empty string",
    "modeOfOperation": "if found (e.g. Single, Joint), else empty string",
    "address": "if found, else empty string"
  }
}`;

  let parsed = null;

  // 1. Try Gemini
  const gKey = geminiKey || process.env.GEMINI_API_KEY;
  if (gKey) {
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1 }
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          parsed = JSON.parse(raw);
          break;
        }
      } catch (err) {
        console.error(`Gemini classification (${model}) failed:`, err.message);
      }
    }
  }

  // 2. Try OpenAI fallback
  const oKey = openAiKey || process.env.OPENAI_API_KEY;
  if (!parsed && oKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${oKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a banking document analyst. Always respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        })
      });

      if (response.ok) {
        const data = await response.json();
        let raw = data.choices?.[0]?.message?.content || '';
        raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(raw);
      }
    } catch (err) {
      console.error('OpenAI classification failed:', err.message);
    }
  }

  // 3. Fallback structure if no AI response
  if (!parsed) {
    parsed = {
      documentType: 'Other',
      confidence: 'Low',
      customerId: '',
      customerName: '',
      customerRef: '',
      facilityNumber: '',
      facilityRef: '',
      branch: '',
      branchCode: '',
      documentDate: null,
      executionDate: null,
      expiryDate: null,
      accountNumber: '',
      cifNumber: '',
      ifscCode: '',
      accountType: '',
      signatory: '',
      partner: '',
      typeOfService: '',
      summary: `Document: ${fileName}`,
      suggestedTags: [],
      otherBankingMetadata: {}
    };
  }

  if (!parsed.otherBankingMetadata) {
    parsed.otherBankingMetadata = {};
  }

  // --- Regex Heuristic Extraction Layer (Guarantees banking fields from OCR text) ---
  const rawText = text || '';

  // 1. Account Number
  if (!parsed.accountNumber) {
    const accMatch = rawText.match(/(?:Account\s*No\.?|A\/c\s*No\.?|Account\s*Number|Acc\s*No\.?|A\/C\s*Number|A\/C\s*#|Account\s*#)\s*[:=\-]?\s*([A-Za-z0-9\-\/]{6,25})/i);
    if (accMatch) {
      parsed.accountNumber = accMatch[1].trim();
    }
  }

  // 2. CIF Number / Customer ID
  if (!parsed.cifNumber || !parsed.customerId) {
    const cifMatch = rawText.match(/(?:CIF\s*No\.?|CIF\s*Number|Customer\s*ID|Cust\s*ID|CIF\s*#|Client\s*ID|CIF)\s*[:=\-]?\s*([A-Za-z0-9\-\/]{4,25})/i);
    if (cifMatch) {
      const cifVal = cifMatch[1].trim();
      if (!parsed.cifNumber) parsed.cifNumber = cifVal;
      if (!parsed.customerId) parsed.customerId = cifVal;
    }
  }

  // 3. IFSC Code
  if (!parsed.ifscCode) {
    const ifscMatch = rawText.match(/(?:IFSC\s*Code|IFSC\s*No\.?|IFSC)\s*[:=\-]?\s*([A-Z0-9]{8,15})/i) ||
                      rawText.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i);
    if (ifscMatch) {
      parsed.ifscCode = ifscMatch[1].trim().toUpperCase();
    }
  }

  // 4. Branch Name & Branch Code
  if (!parsed.branch) {
    const branchMatch = rawText.match(/(?:Br\.?\s*Name|Branch\s*Name|Branch)\s*[:=\-]?\s*([^\n\r,;:]{2,40})/i);
    if (branchMatch) {
      parsed.branch = branchMatch[1].trim();
    }
  }
  if (!parsed.branchCode) {
    const brCodeMatch = rawText.match(/(?:Br\.?\s*Code|Branch\s*Code|Branch\s*#)\s*[:=\-]?\s*([A-Za-z0-9]{2,10})/i);
    if (brCodeMatch) {
      parsed.branchCode = brCodeMatch[1].trim();
    }
  }

  // 5. Customer Name
  if (!parsed.customerName) {
    const nameMatch = rawText.match(/(?:Customer\s*Name|Borrower\s*Name|Account\s*Holder\s*Name|Name\s*of\s*Account\s*Holder|Applicant\s*Name)\s*[:=\-]?\s*([^\n\r,;:]{2,50})/i);
    if (nameMatch) {
      parsed.customerName = nameMatch[1].trim();
    }
  }

  // 6. Account Type
  if (!parsed.accountType) {
    const typeMatch = rawText.match(/(?:A\/C\s*Type|Account\s*Type)\s*[:=\-]?\s*([^\n\r,;:]{2,50})/i);
    if (typeMatch) {
      parsed.accountType = typeMatch[1].trim();
    }
  }

  // 7. Date of Issuing / Document Date
  if (!parsed.documentDate && !parsed.executionDate) {
    const dateMatch = rawText.match(/(?:Date\s*of\s*Issu(?:ing|e)|Issue\s*Date|Execution\s*Date|Date\s*of\s*Execution)\s*[:=\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/i);
    if (dateMatch) {
      try {
        const parts = dateMatch[1].split(/[\/\-\.]/);
        let dateObj;
        if (parts[0].length === 4) {
          dateObj = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
        } else if (parts[2].length === 4) {
          dateObj = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }
        if (dateObj && !isNaN(dateObj.getTime())) {
          parsed.documentDate = dateObj;
          parsed.executionDate = dateObj;
        }
      } catch (err) {}
    }
  }

  // 8. Father / Spouse Name
  if (!parsed.otherBankingMetadata.fatherOrSpouseName) {
    const fatherMatch = rawText.match(/(?:Father\/Spouse\s*Name|Father's\s*Name|Spouse\s*Name|Father\s*Name)\s*[:=\-]?\s*([^\n\r,;:]{2,50})/i);
    if (fatherMatch) {
      parsed.otherBankingMetadata.fatherOrSpouseName = fatherMatch[1].trim();
    }
  }

  // 9. Joint Account Holder
  if (!parsed.otherBankingMetadata.jointAccountHolder) {
    const jointMatch = rawText.match(/(?:Joint\s*Account\s*Holder|Joint\s*Holder|Secondary\s*Holder)\s*[:=\-]?\s*([^\n\r,;:]{2,50})/i);
    if (jointMatch) {
      parsed.otherBankingMetadata.jointAccountHolder = jointMatch[1].trim();
    }
  }

  // 10. Mode of Operation
  if (!parsed.otherBankingMetadata.modeOfOperation) {
    const modeMatch = rawText.match(/(?:Mode\s*of\s*Operation)\s*[:=\-]?\s*([^\n\r,;:]{2,30})/i);
    if (modeMatch) {
      parsed.otherBankingMetadata.modeOfOperation = modeMatch[1].trim();
    }
  }

  // Normalization: Ensure customerRef contains name/ID if separate fields extracted
  if (!parsed.customerRef) {
    if (parsed.customerName && parsed.accountNumber) {
      parsed.customerRef = `${parsed.customerName} (A/C: ${parsed.accountNumber})`;
    } else if (parsed.customerName) {
      parsed.customerRef = parsed.customerName;
    } else if (parsed.customerId) {
      parsed.customerRef = parsed.customerId;
    }
  }

  if (!parsed.facilityRef) {
    parsed.facilityRef = parsed.facilityNumber || parsed.accountNumber || '';
  }

  if (!parsed.facilityNumber && parsed.accountNumber) {
    parsed.facilityNumber = parsed.accountNumber;
  }

  if (!parsed.documentDate) {
    parsed.documentDate = parsed.executionDate || null;
  }

  // If document contains bank passbook keywords, classify as Bank Passbook
  if (rawText.toLowerCase().includes('pass-book') || rawText.toLowerCase().includes('passbook') || rawText.toLowerCase().includes('jan dhan')) {
    if (parsed.documentType === 'Other' || !parsed.documentType) {
      parsed.documentType = 'Bank Passbook';
      parsed.confidence = 'High';
    }
  }

  const valResult = validateMandatoryFields(parsed);
  parsed.missingMandatoryFields = valResult.missingMandatoryFields;
  parsed.validationStatus = valResult.validationStatus;

  return parsed;
}

/**
 * Validates mandatory fields based on document type
 */
function validateMandatoryFields(parsed) {
  const missing = [];
  const docType = (parsed.documentType || '').toLowerCase();

  if (docType.includes('kyc') || docType.includes('passbook')) {
    if (!parsed.customerName && !parsed.customerId && !parsed.customerRef) missing.push('Customer Name / ID');
    if (!parsed.documentDate && !parsed.executionDate) missing.push('Document Issue Date');
    if (!parsed.accountNumber && !parsed.cifNumber && !parsed.facilityNumber) missing.push('Account / CIF Number');
    if (!parsed.branch) missing.push('Branch Name');
  } else if (docType.includes('loan') || docType.includes('facility') || docType.includes('sanction')) {
    if (!parsed.customerName && !parsed.customerRef) missing.push('Borrower / Customer Name');
    if (!parsed.facilityNumber && !parsed.facilityRef) missing.push('Facility / Loan Number');
    if (!parsed.documentDate && !parsed.executionDate) missing.push('Execution / Sanction Date');
    if (!parsed.expiryDate) missing.push('Expiry / Maturity Date');
  } else if (docType.includes('mortgage') || docType.includes('guarantee')) {
    if (!parsed.customerName && !parsed.customerRef) missing.push('Customer Name');
    if (!parsed.documentDate && !parsed.executionDate) missing.push('Document Date');
    if (!parsed.signatory) missing.push('Authorized Signatory');
  } else if (docType.includes('resolution') || docType.includes('agreement') || docType.includes('contract')) {
    if (!parsed.customerName && !parsed.partner && !parsed.customerRef) missing.push('Party / Customer Name');
    if (!parsed.documentDate && !parsed.executionDate) missing.push('Document Date');
  } else {
    // General mandatory check
    if (!parsed.customerRef && !parsed.customerName && !parsed.customerId) missing.push('Customer Identifier');
    if (!parsed.documentDate && !parsed.executionDate) missing.push('Document Date');
  }

  return {
    missingMandatoryFields: missing,
    validationStatus: missing.length === 0 ? 'Valid' : 'Incomplete'
  };
}

/**
 * Sends text to AI for summarization, trying Gemini first, then falling back to OpenAI
 */
async function summarizeText(title, text, isFolder = false, headerGeminiKey = null, headerOpenAiKey = null) {
  const maxChars = 20000;
  const trimmedText = text.length > maxChars ? text.substring(0, maxChars) + '\n[Content Truncated due to size...]' : text;

  const prompt = isFolder
    ? `You are an AI document assistant. Below is the list of files and content previews inside the folder "${title}":\n\n${trimmedText}\n\nProvide a high-level summary of the files inside this folder, explaining what kind of documents are stored here and their main purpose. Keep it to 3-5 concise bullet points. Output only clean Markdown.`
    : `You are an AI document assistant. Summarize the contents of the document "${title}" based on the following text content:\n\n${trimmedText}\n\nProvide a summary in 3-5 concise bullet points. Output only clean Markdown.`;

  const geminiKey = headerGeminiKey || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of modelsToTry) {
      try {
        console.log(`Attempting summarization with Gemini (${model})...`);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (summary) return summary.trim();
        } else {
          const errorText = await response.text();
          console.warn(`Gemini API (${model}) returned status ${response.status}:`, errorText);
        }
      } catch (err) {
        console.error(`Gemini API call for ${model} failed:`, err);
      }
    }
  }

  const openAiKey = headerOpenAiKey || process.env.OPENAI_API_KEY;
  if (openAiKey) {
    try {
      console.log('Attempting summarization with OpenAI fallback...');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that summarizes documents.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content;
        if (summary) return summary.trim();
      } else {
        const errorText = await response.text();
        console.warn(`OpenAI API returned status ${response.status}:`, errorText);
      }
    } catch (err) {
      console.error('OpenAI API call failed:', err);
    }
  }

  throw new Error('AI Summarization failed: No configured API keys succeeded.');
}

module.exports = {
  extractText,
  ocrWithGemini,
  classifyAndExtractMetadata,
  validateMandatoryFields,
  summarizeText
};
