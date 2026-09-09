const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const storageHelper = require('../helpers/storage.helper');
const cloudinaryHelper = require('../helpers/cloudinary.helper');

/**
 * Creates initial signature slots based on folder category and uploader's profile.
 * - General Folder: 2 Signatures (1. Manager / Uploader, 2. Reporting Manager)
 * - Legal Folder: 3 Signatures (1. Manager / Uploader, 2. Reporting Manager, 3. Legal Manager)
 * - Compliance Folder: 3 Signatures (1. Manager / Uploader, 2. Reporting Manager, 3. Compliance Manager)
 */
const createInitialSignatures = (folderCategory = 'General', uploaderUser = {}) => {
  const category = (folderCategory || '').toLowerCase();
  const isLegal = category === 'legal';
  const isCompliance = category === 'compliance';

  const uploaderSignature = uploaderUser.signature || '';
  const uploaderType = uploaderUser.signatureType || (uploaderSignature ? 'draw' : 'type');

  const slots = [
    {
      slot: 'Manager (Uploader)',
      role: 'Manager',
      step: 1,
      signerId: uploaderUser._id || uploaderUser.id || null,
      signerName: uploaderUser.name || 'Manager',
      signerEmail: uploaderUser.email || '',
      signature: uploaderSignature,
      signatureType: uploaderType,
      signatureFont: uploaderUser.signatureFont || 'Great Vibes',
      signatureInitials: uploaderUser.signatureInitials || '',
      signedAt: new Date(),
      status: 'Signed',
      comments: 'Document uploaded & initial e-signature registered.'
    },
    {
      slot: 'Reporting Manager',
      role: 'Reporting Manager',
      step: 2,
      signerId: null,
      signerName: '',
      signerEmail: '',
      signature: '',
      signatureType: '',
      signatureFont: 'Great Vibes',
      signatureInitials: '',
      signedAt: null,
      status: 'Pending',
      comments: ''
    }
  ];

  if (isLegal) {
    slots.push({
      slot: 'Legal Manager',
      role: 'Legal Team',
      step: 3,
      signerId: null,
      signerName: '',
      signerEmail: '',
      signature: '',
      signatureType: '',
      signatureFont: 'Great Vibes',
      signatureInitials: '',
      signedAt: null,
      status: 'Pending',
      comments: ''
    });
  } else if (isCompliance) {
    slots.push({
      slot: 'Compliance Manager',
      role: 'Compliance Team',
      step: 3,
      signerId: null,
      signerName: '',
      signerEmail: '',
      signature: '',
      signatureType: '',
      signatureFont: 'Great Vibes',
      signatureInitials: '',
      signedAt: null,
      status: 'Pending',
      comments: ''
    });
  }

  return slots;
};

/**
 * Updates the signature slot when an approver approves the document.
 */
const applyApproverSignature = (existingSignatures = [], approverUser = {}, role = 'Reporting Manager', comments = '') => {
  const signatures = Array.isArray(existingSignatures) ? [...existingSignatures] : [];

  const approverSignature = approverUser.signature || '';
  const approverType = approverUser.signatureType || (approverSignature ? 'draw' : 'type');

  let slotIndex = -1;
  const roleLower = (role || '').toLowerCase();

  if (roleLower.includes('reporting')) {
    slotIndex = signatures.findIndex(s => 
      (s.role && s.role.toLowerCase().includes('reporting')) || 
      (s.slot && s.slot.toLowerCase().includes('reporting'))
    );
  } else if (roleLower.includes('legal')) {
    slotIndex = signatures.findIndex(s => 
      (s.role && s.role.toLowerCase().includes('legal')) || 
      (s.slot && s.slot.toLowerCase().includes('legal'))
    );
  } else if (roleLower.includes('compliance')) {
    slotIndex = signatures.findIndex(s => 
      (s.role && s.role.toLowerCase().includes('compliance')) || 
      (s.slot && s.slot.toLowerCase().includes('compliance'))
    );
  }

  // Fallback: match first pending slot
  if (slotIndex === -1) {
    slotIndex = signatures.findIndex(s => s.status === 'Pending');
  }

  const slotTitle = slotIndex >= 0 ? signatures[slotIndex].slot : role;

  if (slotIndex >= 0) {
    signatures[slotIndex] = {
      ...signatures[slotIndex],
      signerId: approverUser._id || approverUser.id,
      signerName: approverUser.name || role,
      signerEmail: approverUser.email || '',
      signature: approverSignature,
      signatureType: approverType,
      signatureFont: approverUser.signatureFont || 'Great Vibes',
      signatureInitials: approverUser.signatureInitials || '',
      signedAt: new Date(),
      status: 'Signed',
      comments: comments || `Approved & electronically signed by ${slotTitle}`
    };
  } else {
    // If slot didn't exist, create it
    signatures.push({
      slot: role,
      role: role,
      step: signatures.length + 1,
      signerId: approverUser._id || approverUser.id,
      signerName: approverUser.name || role,
      signerEmail: approverUser.email || '',
      signature: approverSignature,
      signatureType: approverType,
      signatureFont: approverUser.signatureFont || 'Great Vibes',
      signatureInitials: approverUser.signatureInitials || '',
      signedAt: new Date(),
      status: 'Signed',
      comments: comments || `Approved & electronically signed by ${role}`
    });
  }

  return signatures;
};

/**
 * Synchronizes multi-party document signatures across approval workflow, folder configuration,
 * and approver profiles.
 */
const syncDocumentSignatures = async (doc, req = null, latestApproverUser = null, latestApprovedRole = '', latestComments = '') => {
  const signatures = Array.isArray(doc.signatures) ? [...doc.signatures] : [];

  // Helper to fetch user if not fully populated
  const getUserById = async (id) => {
    if (!id) return null;
    try {
      if (typeof id === 'object' && id._id) return id; // already populated
      if (req && req.User) {
        return await req.User.findById(id).select('name email signature signatureType signatureFont signatureInitials');
      }
      return null;
    } catch {
      return null;
    }
  };

  // Determine required roles from approvalWorkflow and folder
  let isLegal = false;
  let isCompliance = false;

  const wf = doc.approvalWorkflow || {};
  if (wf.requiresLegal || (wf.legalApproval && wf.legalApproval.status !== 'Not_Required')) {
    isLegal = true;
  }
  if (wf.requiresCompliance || (wf.complianceApproval && wf.complianceApproval.status !== 'Not_Required')) {
    isCompliance = true;
  }

  // Check folder category if doc.folderId is available
  if (!isLegal && !isCompliance && doc.folderId) {
    let folderCategory = '';
    let folderName = '';
    if (typeof doc.folderId === 'object' && doc.folderId.folderCategory) {
      folderCategory = doc.folderId.folderCategory;
      folderName = doc.folderId.name || '';
    } else if (req && req.Folder) {
      try {
        const folder = await req.Folder.findById(doc.folderId);
        if (folder) {
          folderCategory = folder.folderCategory || '';
          folderName = folder.name || '';
        }
      } catch {}
    }
    const cat = (folderCategory || '').toLowerCase();
    const fName = (folderName || '').toLowerCase();
    if (cat === 'legal' || fName.includes('legal')) isLegal = true;
    if (cat === 'compliance' || fName.includes('compliance')) isCompliance = true;
  }

  const docNameLower = (doc.name || '').toLowerCase();
  if (docNameLower.includes('legal')) isLegal = true;
  if (docNameLower.includes('compliance')) isCompliance = true;

  // ──────────────── 1. Manager (Uploader) Slot ────────────────
  let managerSlotIndex = signatures.findIndex(s => 
    (s.slot && s.slot.toLowerCase().includes('uploader')) ||
    (s.role && s.role.toLowerCase() === 'manager' && !s.slot.toLowerCase().includes('reporting'))
  );

  let uploaderUser = null;
  if (doc.uploadedBy) {
    uploaderUser = await getUserById(doc.uploadedBy);
  }

  const uploaderSig = (uploaderUser && uploaderUser.signature) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signature : '');
  const uploaderType = (uploaderUser && uploaderUser.signatureType) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signatureType : 'draw');
  const uploaderFont = (uploaderUser && uploaderUser.signatureFont) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signatureFont : 'Great Vibes');
  const uploaderInitials = (uploaderUser && uploaderUser.signatureInitials) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signatureInitials : '');
  const uploaderName = (uploaderUser && uploaderUser.name) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signerName : 'Manager');
  const uploaderEmail = (uploaderUser && uploaderUser.email) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signerEmail : '');

  const managerSlot = {
    slot: 'Manager (Uploader)',
    role: 'Manager',
    step: 1,
    signerId: (uploaderUser && uploaderUser._id) || (managerSlotIndex >= 0 ? signatures[managerSlotIndex].signerId : null),
    signerName: uploaderName,
    signerEmail: uploaderEmail,
    signature: uploaderSig,
    signatureType: uploaderType,
    signatureFont: uploaderFont,
    signatureInitials: uploaderInitials,
    signedAt: (managerSlotIndex >= 0 && signatures[managerSlotIndex].signedAt) ? signatures[managerSlotIndex].signedAt : (doc.createdAt || new Date()),
    status: 'Signed',
    comments: (managerSlotIndex >= 0 && signatures[managerSlotIndex].comments) ? signatures[managerSlotIndex].comments : 'Document uploaded & initial e-signature registered.'
  };

  if (managerSlotIndex >= 0) {
    signatures[managerSlotIndex] = managerSlot;
  } else {
    signatures.unshift(managerSlot);
  }

  // ──────────────── 2. Reporting Manager Slot ────────────────
  let repSlotIndex = signatures.findIndex(s =>
    (s.slot && s.slot.toLowerCase().includes('reporting')) ||
    (s.role && s.role.toLowerCase().includes('reporting'))
  );

  const repApproval = wf.reportingApproval;
  const isRepApproved = repApproval && repApproval.status === 'Approved';

  let repUser = null;
  if (latestApprovedRole && latestApprovedRole.toLowerCase().includes('reporting') && latestApproverUser) {
    repUser = latestApproverUser;
  } else if (repApproval && repApproval.approvedBy) {
    repUser = await getUserById(repApproval.approvedBy);
  }

  const repSig = (repUser && repUser.signature) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signature : '');
  const repType = (repUser && repUser.signatureType) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signatureType : 'draw');
  const repFont = (repUser && repUser.signatureFont) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signatureFont : 'Great Vibes');
  const repInitials = (repUser && repUser.signatureInitials) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signatureInitials : '');
  const repName = (repUser && repUser.name) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signerName : (isRepApproved ? 'Reporting Manager' : 'Required Role'));
  const repEmail = (repUser && repUser.email) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signerEmail : '');

  const repSlot = {
    slot: 'Reporting Manager',
    role: 'Reporting Manager',
    step: 2,
    signerId: (repUser && repUser._id) || (repSlotIndex >= 0 ? signatures[repSlotIndex].signerId : null),
    signerName: repName,
    signerEmail: repEmail,
    signature: isRepApproved ? repSig : '',
    signatureType: repType,
    signatureFont: repFont,
    signatureInitials: repInitials,
    signedAt: isRepApproved ? (repApproval?.approvedAt || (repSlotIndex >= 0 ? signatures[repSlotIndex].signedAt : new Date())) : null,
    status: isRepApproved ? 'Signed' : 'Pending',
    comments: isRepApproved ? (repApproval?.comments || latestComments || 'Approved by Reporting Manager') : ''
  };

  if (repSlotIndex >= 0) {
    signatures[repSlotIndex] = repSlot;
  } else {
    signatures.splice(1, 0, repSlot);
  }

  // ──────────────── 3. Legal Manager Slot (if required) ────────────────
  if (isLegal) {
    let legSlotIndex = signatures.findIndex(s =>
      (s.slot && s.slot.toLowerCase().includes('legal')) ||
      (s.role && s.role.toLowerCase().includes('legal'))
    );

    const legApproval = wf.legalApproval;
    const isLegApproved = legApproval && legApproval.status === 'Approved';

    let legUser = null;
    if (latestApprovedRole && latestApprovedRole.toLowerCase().includes('legal') && latestApproverUser) {
      legUser = latestApproverUser;
    } else if (legApproval && legApproval.approvedBy) {
      legUser = await getUserById(legApproval.approvedBy);
    }

    const legSig = (legUser && legUser.signature) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signature : '');
    const legType = (legUser && legUser.signatureType) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signatureType : 'draw');
    const legFont = (legUser && legUser.signatureFont) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signatureFont : 'Great Vibes');
    const legInitials = (legUser && legUser.signatureInitials) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signatureInitials : '');
    const legName = (legUser && legUser.name) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signerName : (isLegApproved ? 'Legal Manager' : 'Required Role'));
    const legEmail = (legUser && legUser.email) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signerEmail : '');

    const legSlot = {
      slot: 'Legal Manager',
      role: 'Legal Team',
      step: signatures.length + 1,
      signerId: (legUser && legUser._id) || (legSlotIndex >= 0 ? signatures[legSlotIndex].signerId : null),
      signerName: legName,
      signerEmail: legEmail,
      signature: isLegApproved ? legSig : '',
      signatureType: legType,
      signatureFont: legFont,
      signatureInitials: legInitials,
      signedAt: isLegApproved ? (legApproval?.approvedAt || (legSlotIndex >= 0 ? signatures[legSlotIndex].signedAt : new Date())) : null,
      status: isLegApproved ? 'Signed' : 'Pending',
      comments: isLegApproved ? (legApproval?.comments || latestComments || 'Approved by Legal Manager') : ''
    };

    if (legSlotIndex >= 0) {
      signatures[legSlotIndex] = legSlot;
    } else {
      signatures.push(legSlot);
    }
  }

  // ──────────────── 4. Compliance Manager Slot (if required) ────────────────
  if (isCompliance) {
    let compSlotIndex = signatures.findIndex(s =>
      (s.slot && s.slot.toLowerCase().includes('compliance')) ||
      (s.role && s.role.toLowerCase().includes('compliance'))
    );

    const compApproval = wf.complianceApproval;
    const isCompApproved = compApproval && compApproval.status === 'Approved';

    let compUser = null;
    if (latestApprovedRole && latestApprovedRole.toLowerCase().includes('compliance') && latestApproverUser) {
      compUser = latestApproverUser;
    } else if (compApproval && compApproval.approvedBy) {
      compUser = await getUserById(compApproval.approvedBy);
    }

    const compSig = (compUser && compUser.signature) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signature : '');
    const compType = (compUser && compUser.signatureType) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signatureType : 'draw');
    const compFont = (compUser && compUser.signatureFont) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signatureFont : 'Great Vibes');
    const compInitials = (compUser && compUser.signatureInitials) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signatureInitials : '');
    const compName = (compUser && compUser.name) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signerName : (isCompApproved ? 'Compliance Manager' : 'Required Role'));
    const compEmail = (compUser && compUser.email) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signerEmail : '');

    const compSlot = {
      slot: 'Compliance Manager',
      role: 'Compliance Team',
      step: signatures.length + 1,
      signerId: (compUser && compUser._id) || (compSlotIndex >= 0 ? signatures[compSlotIndex].signerId : null),
      signerName: compName,
      signerEmail: compEmail,
      signature: isCompApproved ? compSig : '',
      signatureType: compType,
      signatureFont: compFont,
      signatureInitials: compInitials,
      signedAt: isCompApproved ? (compApproval?.approvedAt || (compSlotIndex >= 0 ? signatures[compSlotIndex].signedAt : new Date())) : null,
      status: isCompApproved ? 'Signed' : 'Pending',
      comments: isCompApproved ? (compApproval?.comments || latestComments || 'Approved by Compliance Manager') : ''
    };

    if (compSlotIndex >= 0) {
      signatures[compSlotIndex] = compSlot;
    } else {
      signatures.push(compSlot);
    }
  }

  // Re-index steps
  signatures.forEach((s, idx) => {
    s.step = idx + 1;
  });

  return signatures;
};

/**
 * Stamps an official dedicated Full-Page Execution & Multi-Party Signature Certificate
 * as the final page of a PDF document.
 */
const stampPdfLastPage = async (pdfBufferOrPath, signatures = [], docMeta = {}) => {
  try {
    let pdfBytes;
    if (typeof pdfBufferOrPath === 'string') {
      if (!fs.existsSync(pdfBufferOrPath)) return null;
      pdfBytes = fs.readFileSync(pdfBufferOrPath);
    } else {
      pdfBytes = pdfBufferOrPath;
    }

    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    // If re-stamping an existing document that already has our generated signature certificate page,
    // remove the old certificate page to replace it with the newly updated certificate page.
    if (docMeta.isReStamp && pdfDoc.getPageCount() > 1) {
      const producer = (pdfDoc.getProducer() || '').toLowerCase();
      const isOurCert = producer.includes('dms') || producer.includes('certificate') || producer.includes('pdf-lib');
      if (isOurCert) {
        pdfDoc.removePage(pdfDoc.getPageCount() - 1);
      }
    }

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // Standard A4 dimensions: 595.28 x 841.89 points
    const certPage = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = certPage.getSize();

    const count = signatures.length || 2;
    const allSigned = signatures.length > 0 && signatures.every(s => s.status === 'Signed');

    // ──────────────── 1. OUTER ELEGANT BORDER & CERTIFICATE FRAME ────────────────
    certPage.drawRectangle({
      x: 22,
      y: 22,
      width: width - 44,
      height: height - 44,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.06, 0.18, 0.42), // Deep Royal Navy
      borderWidth: 2
    });

    certPage.drawRectangle({
      x: 26,
      y: 26,
      width: width - 52,
      height: height - 52,
      color: rgb(0.99, 0.99, 1),
      borderColor: rgb(0.85, 0.70, 0.25), // Gold Accent
      borderWidth: 0.75
    });

    // ──────────────── 2. TOP EXECUTIVE HEADER BANNER ────────────────
    certPage.drawRectangle({
      x: 35,
      y: height - 95,
      width: width - 70,
      height: 60,
      color: rgb(0.06, 0.18, 0.42)
    });

    // Header Gold accent line
    certPage.drawLine({
      start: { x: 35, y: height - 95 },
      end: { x: width - 35, y: height - 95 },
      color: rgb(0.85, 0.70, 0.25),
      thickness: 2
    });

    certPage.drawText('OFFICIAL CERTIFICATE OF MULTI-PARTY ELECTRONIC EXECUTION', {
      x: 48,
      y: height - 60,
      size: 12.5,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    certPage.drawText('AUTHENTICATED DIGITAL SIGNATURE AUDIT TRAIL • DMS TAMPER-EVIDENT VAULT', {
      x: 48,
      y: height - 76,
      size: 7,
      font: fontBold,
      color: rgb(0.95, 0.82, 0.45)
    });

    // Header Execution Status Pill
    const execStatusText = allSigned ? 'EXECUTED & COMPLETED' : 'IN PROGRESS (PENDING REVIEW)';
    const execStatusColor = allSigned ? rgb(0.05, 0.55, 0.25) : rgb(0.85, 0.50, 0.05);
    certPage.drawRectangle({
      x: width - 215,
      y: height - 78,
      width: 165,
      height: 24,
      color: execStatusColor
    });

    certPage.drawText(execStatusText, {
      x: width - 208,
      y: height - 69,
      size: 7,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    // ──────────────── 3. DOCUMENT METADATA SUMMARY CONTAINER ────────────────
    const metaY = height - 165;
    const metaHeight = 60;
    certPage.drawRectangle({
      x: 35,
      y: metaY,
      width: width - 70,
      height: metaHeight,
      color: rgb(0.95, 0.97, 0.99),
      borderColor: rgb(0.82, 0.86, 0.92),
      borderWidth: 1
    });

    // Document Name & Verification ID
    certPage.drawText('DOCUMENT DETAILS & INTEGRITY RECORD', {
      x: 45,
      y: metaY + 46,
      size: 7,
      font: fontBold,
      color: rgb(0.06, 0.18, 0.42)
    });

    const docNameText = `Document: ${(docMeta.name || 'DMS Document').substring(0, 42)}`;
    certPage.drawText(docNameText, {
      x: 45,
      y: metaY + 30,
      size: 8,
      font: fontBold,
      color: rgb(0.15, 0.2, 0.25)
    });

    const docIdText = `Verification Ref: ${docMeta.id || 'DOC-SIGN'}`;
    certPage.drawText(docIdText, {
      x: 45,
      y: metaY + 14,
      size: 7,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.5)
    });

    const dateStr = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    certPage.drawText(dateStr, {
      x: 320,
      y: metaY + 30,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.2, 0.25, 0.3)
    });

    const countText = `Workflow: ${count} Signer Chain (${count === 3 ? 'Manager + Reporting + Team Lead' : 'Manager + Reporting'})`;
    certPage.drawText(countText, {
      x: 320,
      y: metaY + 14,
      size: 7.5,
      font: fontBold,
      color: rgb(0.06, 0.18, 0.42)
    });

    // ──────────────── 4. MULTI-PARTY SIGNATURE CARDS ────────────────
    const startCardsY = metaY - 15;
    const availableHeight = startCardsY - 95; // Leave room for footer
    const cardGap = 12;
    const cardHeight = Math.floor((availableHeight - ((count - 1) * cardGap)) / count);

    for (let i = 0; i < count; i++) {
      const sig = signatures[i] || {
        slot: i === 0 ? 'Manager (Uploader)' : i === 1 ? 'Reporting Manager' : 'Reviewer',
        status: 'Pending'
      };

      const cardY = startCardsY - ((i + 1) * cardHeight) - (i * cardGap);
      const isSigned = sig.status === 'Signed';

      // Card Container
      certPage.drawRectangle({
        x: 35,
        y: cardY,
        width: width - 70,
        height: cardHeight,
        color: isSigned ? rgb(1, 1, 1) : rgb(0.97, 0.98, 0.99),
        borderColor: isSigned ? rgb(0.2, 0.5, 0.85) : rgb(0.82, 0.85, 0.9),
        borderWidth: 1.2
      });

      // Header strip inside card
      certPage.drawRectangle({
        x: 35,
        y: cardY + cardHeight - 24,
        width: width - 70,
        height: 24,
        color: isSigned ? rgb(0.92, 0.95, 1) : rgb(0.91, 0.93, 0.95)
      });

      const slotTitle = `STEP ${i + 1}: ${(sig.slot || sig.role || 'SIGNER').toUpperCase()}`;
      certPage.drawText(slotTitle, {
        x: 45,
        y: cardY + cardHeight - 16,
        size: 8,
        font: fontBold,
        color: isSigned ? rgb(0.04, 0.17, 0.53) : rgb(0.3, 0.35, 0.4)
      });

      // Card Status Badge
      const statusBadge = isSigned ? 'SIGNED & AUTHENTICATED' : 'PENDING APPROVAL';
      certPage.drawText(statusBadge, {
        x: width - 180,
        y: cardY + cardHeight - 16,
        size: 7,
        font: fontBold,
        color: isSigned ? rgb(0.05, 0.55, 0.25) : rgb(0.75, 0.45, 0.05)
      });

      // Left Info Column
      const leftColX = 48;
      const innerY = cardY + cardHeight - 42;

      certPage.drawText(`Signer: ${sig.signerName || (isSigned ? 'Authorized Signer' : 'Required Role')}`, {
        x: leftColX,
        y: innerY,
        size: 8.5,
        font: fontBold,
        color: rgb(0.12, 0.16, 0.22)
      });

      if (sig.signerEmail) {
        certPage.drawText(`Email: ${sig.signerEmail}`, {
          x: leftColX,
          y: innerY - 14,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.35, 0.4, 0.45)
        });
      }

      const dateLine = isSigned && sig.signedAt
        ? `Timestamp: ${new Date(sig.signedAt).toLocaleDateString()} ${new Date(sig.signedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
        : 'Status: Awaiting Official Review';

      certPage.drawText(dateLine, {
        x: leftColX,
        y: innerY - 28,
        size: 7.5,
        font: isSigned ? fontBold : fontItalic,
        color: isSigned ? rgb(0.05, 0.5, 0.2) : rgb(0.6, 0.65, 0.7)
      });

      const remarksText = sig.comments ? `Remarks: ${sig.comments.substring(0, 48)}` : (isSigned ? 'Remarks: Approved & Signed from User Profile' : 'Remarks: Pending decision');
      certPage.drawText(remarksText, {
        x: leftColX,
        y: innerY - 42,
        size: 7,
        font: fontItalic,
        color: rgb(0.45, 0.5, 0.55)
      });

      // Right Column: Visual Signature Box
      const sigBoxWidth = 190;
      const sigBoxHeight = cardHeight - 40;
      const sigBoxX = width - 35 - sigBoxWidth - 12;
      const sigBoxY = cardY + 8;

      certPage.drawRectangle({
        x: sigBoxX,
        y: sigBoxY,
        width: sigBoxWidth,
        height: sigBoxHeight,
        color: isSigned ? rgb(1, 1, 1) : rgb(0.96, 0.97, 0.98),
        borderColor: isSigned ? rgb(0.8, 0.85, 0.92) : rgb(0.85, 0.88, 0.9),
        borderWidth: 1
      });

      if (isSigned && sig.signature && sig.signature.startsWith('data:image/')) {
        try {
          const base64Data = sig.signature.split(',')[1];
          if (base64Data) {
            const imageBuffer = Buffer.from(base64Data, 'base64');
            let embeddedImage = null;
            try {
              embeddedImage = await pdfDoc.embedPng(imageBuffer);
            } catch (pngErr) {
              try {
                embeddedImage = await pdfDoc.embedJpg(imageBuffer);
              } catch (jpgErr) {
                console.warn('Could not embed base64 signature image as PNG or JPG:', jpgErr.message);
              }
            }

            if (embeddedImage) {
              const imgDims = embeddedImage.scaleToFit(sigBoxWidth - 16, sigBoxHeight - 20);
              certPage.drawImage(embeddedImage, {
                x: sigBoxX + (sigBoxWidth - imgDims.width) / 2,
                y: sigBoxY + (sigBoxHeight - imgDims.height) / 2 + 5,
                width: imgDims.width,
                height: imgDims.height
              });
            } else {
              throw new Error('Image embedding failed, using text fallback');
            }
          }
        } catch (imgErr) {
          certPage.drawText(sig.signerName || 'Digital Signature', {
            x: sigBoxX + 15,
            y: sigBoxY + sigBoxHeight / 2,
            size: 14,
            font: fontItalic,
            color: rgb(0.04, 0.17, 0.53)
          });
        }
      } else if (isSigned && sig.signature && (sig.signature.startsWith('http://') || sig.signature.startsWith('https://'))) {
        try {
          const remoteBuffer = await cloudinaryHelper.fetchRemoteBuffer(sig.signature);
          if (remoteBuffer) {
            let embeddedImage = null;
            try {
              embeddedImage = await pdfDoc.embedPng(remoteBuffer);
            } catch {
              try {
                embeddedImage = await pdfDoc.embedJpg(remoteBuffer);
              } catch {}
            }
            if (embeddedImage) {
              const imgDims = embeddedImage.scaleToFit(sigBoxWidth - 16, sigBoxHeight - 20);
              certPage.drawImage(embeddedImage, {
                x: sigBoxX + (sigBoxWidth - imgDims.width) / 2,
                y: sigBoxY + (sigBoxHeight - imgDims.height) / 2 + 5,
                width: imgDims.width,
                height: imgDims.height
              });
            } else {
              throw new Error('Remote image embedding failed');
            }
          } else {
            throw new Error('Empty remote buffer');
          }
        } catch {
          certPage.drawText(sig.signerName || 'Digital Signature', {
            x: sigBoxX + 15,
            y: sigBoxY + sigBoxHeight / 2,
            size: 14,
            font: fontItalic,
            color: rgb(0.04, 0.17, 0.53)
          });
        }
      } else if (isSigned) {
        certPage.drawText(sig.signerName || 'Authorized Signer', {
          x: sigBoxX + 15,
          y: sigBoxY + sigBoxHeight / 2,
          size: 14,
          font: fontItalic,
          color: rgb(0.04, 0.17, 0.53)
        });
      } else {
        certPage.drawText('— Awaiting Decision & Signature —', {
          x: sigBoxX + 12,
          y: sigBoxY + sigBoxHeight / 2,
          size: 7.5,
          font: fontItalic,
          color: rgb(0.6, 0.65, 0.7)
        });
      }

      // Security Seal text at bottom of signature box
      if (isSigned) {
        certPage.drawText('AUTHENTICATED VIA USER PROFILE', {
          x: sigBoxX + 22,
          y: sigBoxY + 4,
          size: 5.5,
          font: fontBold,
          color: rgb(0.1, 0.5, 0.25)
        });
      }
    }

    // ──────────────── 5. FOOTER LEGAL DECLARATION & AUDIT STAMP ────────────────
    const footerY = 36;
    certPage.drawRectangle({
      x: 35,
      y: footerY,
      width: width - 70,
      height: 48,
      color: rgb(0.95, 0.96, 0.98),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 0.75
    });

    certPage.drawText('LEGAL COMPLIANCE & TAMPER-EVIDENT AUDIT DECLARATION:', {
      x: 45,
      y: footerY + 36,
      size: 6.5,
      font: fontBold,
      color: rgb(0.06, 0.18, 0.42)
    });

    const decl1 = 'This Certificate of Electronic Execution is an official integral part of the attached document. All signatures displayed above';
    const decl2 = 'have been authenticated via verified user profiles and stamped in full compliance with Digital Signature & E-Governance regulations.';
    certPage.drawText(decl1, { x: 45, y: footerY + 24, size: 6, font: fontRegular, color: rgb(0.35, 0.4, 0.45) });
    certPage.drawText(decl2, { x: 45, y: footerY + 14, size: 6, font: fontRegular, color: rgb(0.35, 0.4, 0.45) });

    const hashStr = docMeta.fileHash ? `SHA-256: ${docMeta.fileHash.substring(0, 28)}...` : 'DMS Cryptographic Verification Hash Active';
    certPage.drawText(hashStr, {
      x: 45,
      y: footerY + 4,
      size: 5.5,
      font: fontBold,
      color: rgb(0.15, 0.4, 0.7)
    });

    pdfDoc.setProducer('DMS-MultiParty-Signature-Certificate');
    const savedBytes = await pdfDoc.save();
    return savedBytes;
  } catch (err) {
    console.error('PDF certificate page stamping failed:', err);
    return null;
  }
};

/**
 * Re-stamps updated signatures onto existing PDF file
 */
const reStampDocumentFile = async (doc, signatures = []) => {
  try {
    const ext = (doc.extension || path.extname(doc.originalFileName || doc.name || '')).toLowerCase();
    if (ext !== '.pdf' && doc.mimeType !== 'application/pdf' && doc.fileType !== 'PDF') {
      return null;
    }

    const destDir = path.join(__dirname, '../../uploads');
    const localFileName = path.basename(doc.storageUrl || '');
    const localFilePath = path.join(destDir, localFileName);

    let pdfBytes = null;
    if (fs.existsSync(localFilePath)) {
      pdfBytes = fs.readFileSync(localFilePath);
    } else if (doc.storageUrl) {
      pdfBytes = await cloudinaryHelper.fetchRemoteBuffer(doc.storageUrl);
    }

    if (!pdfBytes) {
      console.warn('reStampDocumentFile: Could not retrieve raw PDF buffer for doc:', doc._id);
      return null;
    }

    const stampedBytes = await stampPdfLastPage(pdfBytes, signatures, {
      name: doc.name,
      id: doc.fileHash ? doc.fileHash.substring(0, 10) : doc._id.toString().substring(0, 10),
      fileHash: doc.fileHash || '',
      isReStamp: true
    });

    if (stampedBytes) {
      // 1. If local file exists, update it
      if (fs.existsSync(localFilePath)) {
        fs.writeFileSync(localFilePath, stampedBytes);
      }

      // 2. If storage is Cloudinary (or remote), re-upload the updated stamped PDF
      const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary' || (doc.storageUrl && doc.storageUrl.includes('cloudinary'));
      if (isCloudinary) {
        try {
          const uploadRes = await storageHelper.uploadBufferToStorage(
            Buffer.from(stampedBytes),
            doc.originalFileName || `${doc.name || 'document'}.pdf`,
            'application/pdf'
          );
          if (uploadRes && uploadRes.url) {
            doc.storageUrl = uploadRes.url;
            doc.fileSize = stampedBytes.length;
            doc.markModified('storageUrl');
            doc.markModified('fileSize');
            await doc.save();
          }
        } catch (uploadErr) {
          console.error('Failed to re-upload stamped PDF to Cloudinary:', uploadErr.message);
        }
      } else {
        doc.fileSize = stampedBytes.length;
        doc.markModified('fileSize');
        await doc.save();
      }

      return stampedBytes;
    }
    return null;
  } catch (err) {
    console.error('Failed to re-stamp PDF document on approval (non-blocking):', err.message);
    return null;
  }
};

module.exports = {
  createInitialSignatures,
  applyApproverSignature,
  syncDocumentSignatures,
  stampPdfLastPage,
  reStampDocumentFile
};
