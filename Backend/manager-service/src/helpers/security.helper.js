const crypto = require('crypto');
const path = require('path');

/**
 * Computes SHA-256 cryptographic hash of a file buffer for binary deduplication
 */
function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Known file signatures (magic bytes) to prevent executable/malicious disguise
 */
const MAGIC_BYTES = {
  PDF: [0x25, 0x50, 0x44, 0x46], // %PDF
  PNG: [0x89, 0x50, 0x4E, 0x47], // .PNG
  JPEG: [0xFF, 0xD8, 0xFF],      // JPEG
  ZIP: [0x50, 0x4B, 0x03, 0x04], // PK.. (ZIP, DOCX, XLSX, PPTX)
  GIF: [0x47, 0x49, 0x46, 0x38], // GIF8
};

const BLOCKED_MAGIC_BYTES = [
  { name: 'Windows Executable (.exe / .dll)', bytes: [0x4D, 0x5A] }, // MZ
  { name: 'Linux Executable (.elf)', bytes: [0x7F, 0x45, 0x4C, 0x46] }, // .ELF
  { name: 'Java Bytecode (.class)', bytes: [0xCA, 0xFE, 0xBA, 0xBE] }, // 0xCAFEBABE
];

/**
 * Validates file signature (magic bytes) to ensure file content matches declared extension
 * and is not an executable or script masquerading as a document.
 */
function validateFileSignature(buffer, declaredExtension) {
  if (!buffer || buffer.length < 4) {
    return { isValid: false, reason: 'File buffer is empty or corrupted' };
  }

  // 1. Check for blocked binary executables
  for (const blocked of BLOCKED_MAGIC_BYTES) {
    let match = true;
    for (let i = 0; i < blocked.bytes.length; i++) {
      if (buffer[i] !== blocked.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return { 
        isValid: false, 
        isMalware: true, 
        reason: `Malicious binary detected: File contains ${blocked.name} signature.` 
      };
    }
  }

  // 2. Validate known safe types
  const ext = (declaredExtension || '').toLowerCase().replace('.', '');
  
  if (ext === 'pdf') {
    const isPdf = MAGIC_BYTES.PDF.every((byte, i) => buffer[i] === byte);
    if (!isPdf) return { isValid: false, reason: 'File claims to be PDF but lacks valid PDF magic bytes.' };
  } else if (['jpg', 'jpeg'].includes(ext)) {
    const isJpeg = MAGIC_BYTES.JPEG.every((byte, i) => buffer[i] === byte);
    if (!isJpeg) return { isValid: false, reason: 'File claims to be JPEG but lacks valid JPEG magic bytes.' };
  } else if (ext === 'png') {
    const isPng = MAGIC_BYTES.PNG.every((byte, i) => buffer[i] === byte);
    if (!isPng) return { isValid: false, reason: 'File claims to be PNG but lacks valid PNG magic bytes.' };
  } else if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext)) {
    const isZip = MAGIC_BYTES.ZIP.every((byte, i) => buffer[i] === byte);
    if (!isZip) return { isValid: false, reason: `File claims to be ${ext.toUpperCase()} but lacks valid package magic bytes.` };
  }

  return { isValid: true, isMalware: false };
}

/**
 * Scans file for viruses and malware.
 * If CLOUDMERSIVE_API_KEY is configured in .env, connects to Cloudmersive Virus Scan API.
 * Otherwise, performs deep signature and heuristic malware checks.
 */
async function scanFileForMalware(buffer, fileName) {
  // Step 1: Run deep magic-byte and executable header verification
  const sigCheck = validateFileSignature(buffer, path.extname(fileName));
  if (!sigCheck.isValid || sigCheck.isMalware) {
    return {
      isClean: false,
      threatFound: sigCheck.reason,
      engine: 'Built-in Signature Guard'
    };
  }

  // Step 2: Check for embedded script injections inside text/HTML formats
  const ext = path.extname(fileName).toLowerCase();
  if (['.txt', '.csv', '.json', '.xml', '.html'].includes(ext)) {
    const content = buffer.toString('utf8', 0, Math.min(buffer.length, 50000));
    const dangerousPatterns = [
      /<script[\s\S]*?>[\s\S]*?<\/script>/i,
      /javascript:/i,
      /onload\s*=/i,
      /onerror\s*=/i,
      /powershell\.exe/i,
      /cmd\.exe\s+\/c/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        return {
          isClean: false,
          threatFound: 'Embedded script injection / malicious command detected in file content.',
          engine: 'Heuristic Content Scanner'
        };
      }
    }
  }

  // Step 3: Cloudmersive / External Antivirus API (if key provided in .env)
  const cloudmersiveKey = process.env.CLOUDMERSIVE_API_KEY;
  if (cloudmersiveKey) {
    try {
      const formData = new FormData();
      formData.append('inputFile', new Blob([buffer]), fileName);

      const response = await fetch('https://api.cloudmersive.com/virus/scan/file', {
        method: 'POST',
        headers: { 'Apikey': cloudmersiveKey },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        if (result.CleanResult === false) {
          return {
            isClean: false,
            threatFound: result.FoundViruses?.[0]?.VirusName || 'Malware detected by Cloudmersive AV',
            engine: 'Cloudmersive AV'
          };
        }
      }
    } catch (avErr) {
      console.warn('External AV scan API failed, falling back to signature guard:', avErr.message);
    }
  }

  return {
    isClean: true,
    threatFound: null,
    engine: cloudmersiveKey ? 'Cloudmersive AV + Signature Guard' : 'Built-in Signature Guard'
  };
}

module.exports = {
  computeFileHash,
  validateFileSignature,
  scanFileForMalware
};
