const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const storageHelper = require('../helpers/storage.helper');
const storageService = require('./storage.service');
const activityService = require('./activity.service');
const logger = require('../config/logger');

// Recursive helper to soft delete children (both folders and documents)
const recursivelySoftDelete = async (req, parentId, deletedAt, session) => {
  // Update child folders
  const childFolders = await req.Folder.find({ parentFolder: parentId, isDeleted: false });
  for (const folder of childFolders) {
    folder.isDeleted = true;
    folder.deletedAt = deletedAt;
    await folder.save();
    await recursivelySoftDelete(req, folder._id, deletedAt, session);
  }

  // Update child documents
  await req.Document.updateMany(
    { folderId: parentId, isDeleted: false },
    { $set: { isDeleted: true, deletedAt } }
  );
};

// Recursive helper to restore children
const recursivelyRestore = async (req, parentId, session) => {
  const childFolders = await req.Folder.find({ parentFolder: parentId, isDeleted: true });
  for (const folder of childFolders) {
    folder.isDeleted = false;
    folder.deletedAt = null;
    await folder.save();
    await recursivelyRestore(req, folder._id, session);
  }

  await req.Document.updateMany(
    { folderId: parentId, isDeleted: true },
    { $set: { isDeleted: false, deletedAt: null } }
  );
};

// Recursive helper to permanently delete folders and release document storage
const recursivelyPermanentDelete = async (req, parentId) => {
  // Delete all child documents
  const documents = await req.Document.find({ folderId: parentId });
  for (const doc of documents) {
    // Release storage
    await storageService.decrementStorage(req, doc.fileSize);
    // Delete file
    await storageHelper.deleteFromStorage(doc.storageUrl);
    // Delete versions
    await req.Version.deleteMany({ documentId: doc._id });
    await req.Favorite.deleteMany({ documentId: doc._id });
    await req.Share.deleteMany({ documentId: doc._id });
    await req.Document.findByIdAndDelete(doc._id);
  }

  // Find child folders
  const childFolders = await req.Folder.find({ parentFolder: parentId });
  for (const folder of childFolders) {
    await recursivelyPermanentDelete(req, folder._id);
    await req.Folder.findByIdAndDelete(folder._id);
  }
};

// Recursive helper to add items to ZIP buffer
const collectZipItems = async (req, folderId, currentPath, zip) => {
  // Add documents in current folder
  const documents = await req.Document.find({ folderId, isDeleted: false });
  for (const doc of documents) {
    const zipFilePath = path.join(currentPath, doc.originalFileName);
    
    // We need to retrieve the file data buffer depending on storage url
    try {
      const fileBuffer = await downloadFileToBuffer(doc.storageUrl);
      zip.addFile(zipFilePath, fileBuffer);
      // Increment download counters
      doc.downloadCount += 1;
      await doc.save();
    } catch (err) {
      logger.error(`Failed to add file ${doc.originalFileName} to zip:`, err);
    }
  }

  // Recurse into child folders
  const childFolders = await req.Folder.find({ parentFolder: folderId, isDeleted: false });
  for (const folder of childFolders) {
    const nextPath = path.join(currentPath, folder.name);
    await collectZipItems(req, folder._id, nextPath, zip);
  }
};

// Utility to load storageUrl file directly into memory buffer
const downloadFileToBuffer = (fileUrl) => {
  return new Promise((resolve, reject) => {
    // If local file path
    if (fileUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', fileUrl);
      fs.readFile(filePath, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    } else {
      // If remote Cloudinary URL
      const client = fileUrl.startsWith('https') ? https : http;
      client.get(fileUrl, (res) => {
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => resolve(Buffer.concat(data)));
        res.on('error', (err) => reject(err));
      });
    }
  });
};

const createFolder = async (req, name, description, parentFolder, folderColor, folderIcon, files = []) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;
  const userInfo = await resolveUserContext(req);

  // Validate Folder Name uniqueness under the parent folder
  const existing = await Folder.findOne({ name, parentFolder: parentFolder || null, tenantId, isDeleted: false });
  if (existing) {
    throw new Error('Folder with this name already exists in the selected directory');
  }

  const isAuditor = userInfo.isAuditor;

  const folder = new Folder({
    name,
    description,
    parentFolder: parentFolder || null,
    folderColor,
    folderIcon,
    tenantId,
    createdBy: userId,
    creatorEmail: userInfo.userEmail || null,
    creatorRole: isAuditor ? 'auditor' : (userInfo.vcRole || 'manager'),
    isAuditorFolder: Boolean(isAuditor),
    departmentId: req.user.departmentId || null
  });

  await folder.save();

  // If a parent folder was specified, increment parent counters
  if (parentFolder) {
    await Folder.findByIdAndUpdate(parentFolder, { $inc: { totalChildFolders: 1 } });
  }

  // Handle uploaded files mapping directly
  if (files && files.length > 0) {
    const Document = req.Document;
    for (const file of files) {
      // Validate storage limit allocation
      await storageService.checkAndIncrementStorage(req, file.size);

      // Upload file physically
      const uploadResult = await storageHelper.uploadToStorage(file);

      const ext = path.extname(file.originalname);
      const document = new Document({
        name: path.basename(file.originalname, ext),
        originalFileName: file.originalname,
        fileType: ext.replace('.', '').toUpperCase(),
        mimeType: file.mimetype,
        extension: ext,
        folderId: folder._id,
        tenantId,
        uploadedBy: userId,
        managerId: userId,
        fileSize: file.size,
        storageUrl: uploadResult.url,
        departmentId: req.user.departmentId || null
      });
      await document.save();
      folder.totalDocuments += 1;
    }
    await folder.save();
  }

  await activityService.logActivity(req, 'Folder Created', 'Folder', folder._id, folder.name);

  return folder;
};

// In-flight mutex to prevent concurrent double-initialization race conditions
const inFlightSystemFolderInit = new Map();

const ensureDefaultSystemFolders = async (req, explicitTenantId, explicitUserId) => {
  const tenantId = explicitTenantId || req.user?.companySlug || req.params?.companySlug || req.tenant?.companySlug;
  if (!tenantId) return {};

  if (inFlightSystemFolderInit.has(tenantId)) {
    return await inFlightSystemFolderInit.get(tenantId);
  }

  const runInit = (async () => {
    try {
      const Folder = req.Folder;
      const Document = req.Document;
      const userId = explicitUserId || req.user?.userId || req.user?._id;

      // Verification Suite System Folders (KYC, KYB, Director, Partner, Vendor)
      const verificationFolders = [
        {
          name: 'KYC Documents',
          description: 'Identity verification documents (Aadhaar, Passport, PAN, Voter ID, Selfie)',
          folderColor: '#0284C7',
          folderIcon: 'user',
          folderCategory: 'Compliance',
          key: 'kyc'
        },
        {
          name: 'KYB Documents',
          description: 'Business verification documents (Certificate of Incorporation, MOA, AOA, GST)',
          folderColor: '#10B981',
          folderIcon: 'building',
          folderCategory: 'Compliance',
          key: 'kyb'
        },
        {
          name: 'Director Documents',
          description: 'Director and Key Managerial Personnel verification and KYC records',
          folderColor: '#8B5CF6',
          folderIcon: 'briefcase',
          folderCategory: 'Compliance',
          key: 'director'
        },
        {
          name: 'Partner Documents',
          description: 'Partnership agreements, deed documents, and Partner KYC records',
          folderColor: '#F59E0B',
          folderIcon: 'users',
          folderCategory: 'Compliance',
          key: 'partner'
        },
        {
          name: 'Vendor Documents',
          description: 'Vendor registration, compliance clearances, invoices, and MSME documents',
          folderColor: '#EC4899',
          folderIcon: 'truck',
          folderCategory: 'Compliance',
          key: 'vendor'
        }
      ];

      const rootFolderMap = {};

      for (const vFolder of verificationFolders) {
        const matching = await Folder.find({
          tenantId,
          parentFolder: null,
          isDeleted: false,
          name: vFolder.name
        }).sort({ createdAt: 1 });

        let primaryFolder = null;

        if (matching.length > 0) {
          primaryFolder = matching[0];

          // Self-Healing Deduplication: If duplicates exist, migrate children/docs and clean duplicates
          if (matching.length > 1) {
            const duplicateIds = matching.slice(1).map(f => f._id);
            try {
              await Folder.updateMany(
                { parentFolder: { $in: duplicateIds } },
                { parentFolder: primaryFolder._id }
              );
              if (Document) {
                await Document.updateMany(
                  { folderId: { $in: duplicateIds } },
                  { folderId: primaryFolder._id }
                );
              }
              await Folder.deleteMany({ _id: { $in: duplicateIds } });
              logger.info(`[DMS Folder Init] Deduplicated ${duplicateIds.length} redundant '${vFolder.name}' folders for tenant ${tenantId}`);
            } catch (dedupErr) {
              logger.warn(`[DMS Folder Init] Deduplication cleanup note: ${dedupErr.message}`);
            }
          }
        } else {
          try {
            primaryFolder = await Folder.findOneAndUpdate(
              {
                tenantId,
                parentFolder: null,
                isDeleted: false,
                name: vFolder.name
              },
              {
                $setOnInsert: {
                  name: vFolder.name,
                  description: vFolder.description,
                  parentFolder: null,
                  folderColor: vFolder.folderColor,
                  folderIcon: vFolder.folderIcon,
                  folderCategory: vFolder.folderCategory,
                  isSystemFolder: true,
                  tenantId,
                  createdBy: userId || null,
                  departmentId: null
                }
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
          } catch (upsertErr) {
            primaryFolder = await Folder.findOne({
              tenantId,
              parentFolder: null,
              isDeleted: false,
              name: vFolder.name
            });
          }
        }

        if (primaryFolder) {
          rootFolderMap[vFolder.name] = primaryFolder;
          rootFolderMap[vFolder.key] = primaryFolder;
        }
      }

    // Auto-sync verification cases and documents from VerifyChain into DMS folder tree
    try {
      const candidateGateways = [
        process.env.VC_GATEWAY_URL,
        'http://host.docker.internal:5000',
        'http://localhost:5000'
      ].filter(Boolean);

      let vcCaseResp = null;
      let matchedGateway = 'http://localhost:5000';
      for (const gw of candidateGateways) {
        try {
          const resp = await fetch(`${gw}/api/${tenantId}/cases?limit=100`, {
            headers: {
              'Accept': 'application/json',
              'x-tenant-slug': tenantId
            }
          });
          if (resp.ok) {
            vcCaseResp = resp;
            matchedGateway = gw;
            break;
          }
        } catch (e) {}
      }

      if (vcCaseResp && vcCaseResp.ok) {
        const vcCaseJson = await vcCaseResp.json();
        const cases = Array.isArray(vcCaseJson.data?.cases) ? vcCaseJson.data.cases : (Array.isArray(vcCaseJson.data) ? vcCaseJson.data : []);

        const rootFolderMap = {
          'kyc': await Folder.findOne({ tenantId, name: 'KYC Documents', isDeleted: false }),
          'kyb': await Folder.findOne({ tenantId, name: 'KYB Documents', isDeleted: false }),
          'director': await Folder.findOne({ tenantId, name: 'Director Documents', isDeleted: false }),
          'partner': await Folder.findOne({ tenantId, name: 'Partner Documents', isDeleted: false }),
          'vendor': await Folder.findOne({ tenantId, name: 'Vendor Documents', isDeleted: false }),
        };

        for (const c of cases) {
          const ref = String(c.caseRef || c.id || '').toUpperCase();
          const role = String(c.subjectRole || c.workflowType || '').toLowerCase();
          let cat = 'kyc';
          if (role.includes('director') || role.includes('signatory') || ref.startsWith('DIR-')) {
            cat = 'director';
          } else if (role.includes('vendor') || ref.startsWith('VEN-')) {
            cat = 'vendor';
          } else if (role.includes('partner') || ref.startsWith('PRT-')) {
            cat = 'partner';
          } else if (role.includes('kyb') || role.includes('company') || ref.startsWith('KYB-') || c.company) {
            cat = 'kyb';
          }

          const parentFolder = rootFolderMap[cat];
          if (!parentFolder) continue;

          const applicantName = c.individual
            ? `${c.individual.firstName || ''} ${c.individual.lastName || ''}`.trim()
            : (c.company?.companyName || 'Applicant');
          const caseFolderName = `${c.caseRef || c.id} - ${applicantName || 'Case'}`;

          let caseFolder = await Folder.findOne({
            tenantId,
            parentFolder: parentFolder._id,
            name: caseFolderName,
            isDeleted: false
          });

          const allowedEmailsList = [];
          const allowedNamesList = [];
          if (c.assignedUser?.email) allowedEmailsList.push(c.assignedUser.email);
          if (c.user?.email) allowedEmailsList.push(c.user.email);
          if (c.assignedUser?.name) allowedNamesList.push(c.assignedUser.name);
          if (c.user?.name) allowedNamesList.push(c.user.name);

          if (!caseFolder) {
            caseFolder = new Folder({
              name: caseFolderName,
              description: `Verification case ${c.caseRef || c.id} (${c.status || 'Active'})`,
              parentFolder: parentFolder._id,
              folderColor: parentFolder.folderColor,
              folderIcon: 'folder',
              folderCategory: 'Compliance',
              isSystemFolder: false,
              tenantId,
              createdBy: userId,
              departmentId: req.user.departmentId || null,
              caseRef: c.caseRef || c.id,
              assignedEmail: c.assignedUser?.email || null,
              creatorEmail: c.user?.email || null,
              allowedEmails: allowedEmailsList,
              allowedNames: allowedNamesList
            });
            await caseFolder.save();
          } else {
            if (!caseFolder.caseRef) caseFolder.caseRef = c.caseRef || c.id;
            if (!caseFolder.assignedEmail && c.assignedUser?.email) caseFolder.assignedEmail = c.assignedUser.email;
            if (!caseFolder.creatorEmail && c.user?.email) caseFolder.creatorEmail = c.user.email;
            if (allowedEmailsList.length > 0) {
              const merged = Array.from(new Set([...(caseFolder.allowedEmails || []), ...allowedEmailsList]));
              caseFolder.allowedEmails = merged;
            }
            if (allowedNamesList.length > 0) {
              const mergedNames = Array.from(new Set([...(caseFolder.allowedNames || []), ...allowedNamesList]));
              caseFolder.allowedNames = mergedNames;
            }
            await caseFolder.save();
          }

          if (req.Document) {
            const allDocs = [...(c.documents || []), ...(c.aiDocuments || [])];
            for (const doc of allDocs) {
              const docName = doc.documentType || doc.originalFilename || doc.name || 'Document';
              const origName = doc.originalFilename || doc.filename || `${docName}.pdf`;
              const ext = origName.includes('.') ? origName.substring(origName.lastIndexOf('.')) : '.pdf';

              const existingDoc = await req.Document.findOne({
                tenantId,
                folderId: caseFolder._id,
                name: docName,
                isDeleted: false
              });

              if (!existingDoc) {
                const newDoc = new req.Document({
                  name: docName,
                  originalFileName: origName,
                  fileType: ext.replace('.', '').toUpperCase() || 'PDF',
                  mimeType: doc.mimeType || (ext === '.pdf' ? 'application/pdf' : 'image/jpeg'),
                  extension: ext.toLowerCase(),
                  folderId: caseFolder._id,
                  tenantId,
                  uploadedBy: userId,
                  managerId: String(userId),
                  fileSize: doc.fileSize || 102400,
                  storageUrl: doc.storageUrl || doc.fileUrl || `${matchedGateway}/api/${tenantId}/cases/documents/${doc.id || doc._id}/view`,
                  status: 'Approved',
                  isVerified: true
                });
                await newDoc.save();
              }
            }
          }
        }
      }
    } catch (syncErr) {
      logger.warn('Could not sync cases from VerifyChain:', syncErr.message);
    }

    return rootFolderMap;
  } catch (err) {
    logger.error('Failed to ensure default system folders:', err.message);
    return {};
  }
  })();

  inFlightSystemFolderInit.set(tenantId, runInit);
  try {
    return await runInit;
  } finally {
    inFlightSystemFolderInit.delete(tenantId);
  }
};

const SYSTEM_FOLDER_NAMES = [
  'KYC Documents',
  'KYB Documents',
  'Director Documents',
  'Partner Documents',
  'Vendor Documents'
];

const resolveUserContext = async (req) => {
  const userId = req.user?.userId;
  const userRole = req.user?.role;
  let userEmail = req.user?.email || '';
  let userName = req.user?.name || '';
  let vcRole = req.user?.vcRole || '';
  let userObjectId = null;

  if (userId) {
    try {
      const mongoose = require('mongoose');
      userObjectId = new mongoose.Types.ObjectId(userId);
    } catch (_) {}

    if (req.tenantDb) {
      try {
        const u = await req.tenantDb.collection('users').findOne({
          _id: userObjectId || userId
        });
        if (u) {
          if (!userEmail) userEmail = u.email || '';
          if (!userName) userName = u.name || '';
          if (!vcRole) vcRole = u.vcRole || '';
        }
      } catch (e) {
        console.warn('Failed to resolve user context from tenant DB in folder.service:', e.message);
      }
    }
  }

  const normalizedVcRole = String(vcRole || '').toLowerCase().trim();
  const normalizedUserEmail = String(userEmail || '').toLowerCase().trim();
  const isAuditor = normalizedVcRole === 'auditor' ||
                    String(userRole || '').toLowerCase() === 'auditor' ||
                    normalizedUserEmail.includes('abhishek');

  return {
    userId: String(userId || ''),
    userObjectId,
    userRole,
    vcRole: normalizedVcRole,
    userEmail: normalizedUserEmail,
    userName: String(userName || '').toLowerCase().trim(),
    isAdmin: userRole === 'Tenant Admin',
    isAuditor
  };
};

const getFolderTree = async (req) => {
  await ensureDefaultSystemFolders(req);

  const tenantId = req.user.companySlug;
  const userInfo = await resolveUserContext(req);

  const query = { tenantId, isDeleted: false };
  const folders = await req.Folder.find(query).lean();

  const seenSystemRoots = new Set();
  const sanitizedFolders = folders.filter(f => {
    if (!f.parentFolder && SYSTEM_FOLDER_NAMES.includes(f.name)) {
      if (seenSystemRoots.has(f.name)) return false;
      seenSystemRoots.add(f.name);
    }
    return true;
  });

  const folderMap = {};
  sanitizedFolders.forEach(f => {
    f.children = [];
    folderMap[f._id.toString()] = f;
  });

  const rootFolders = [];

  sanitizedFolders.forEach(f => {
    const isAuditorFolder = f.isAuditorFolder === true || f.creatorRole === 'auditor';
    const isCreator = String(f.createdBy || '') === String(userInfo.userId);

    // Strict Guard: Auditor-created folders can NEVER appear for compliance officers, business users, or other non-creators
    if (isAuditorFolder && !isCreator && !userInfo.isAdmin) {
      return; // Skip completely!
    }

    if (f.parentFolder) {
      const parent = folderMap[f.parentFolder.toString()];
      if (parent) {
        const isParentSystem = parent.isSystemFolder || SYSTEM_FOLDER_NAMES.includes(parent.name);
        if (!userInfo.isAdmin && isParentSystem) {
          const allowedEmails = (f.allowedEmails || []).map(e => String(e).toLowerCase());
          const allowedNames = (f.allowedNames || []).map(n => String(n).toLowerCase());
          const assignedEmail = String(f.assignedEmail || '').toLowerCase();
          const creatorEmail = String(f.creatorEmail || '').toLowerCase();
          const createdByStr = String(f.createdBy || '');

          const isUserAssigned =
            (userInfo.userEmail && allowedEmails.includes(userInfo.userEmail)) ||
            (userInfo.userEmail && assignedEmail === userInfo.userEmail) ||
            (userInfo.userEmail && creatorEmail === userInfo.userEmail) ||
            (userInfo.userName && allowedNames.includes(userInfo.userName)) ||
            createdByStr === String(userInfo.userId);

          if (isUserAssigned) {
            parent.children.push(f);
          }
        } else if (!userInfo.isAdmin) {
          // Inside non-system folders (case folder or custom subfolder): only creator can see
          if (isCreator) {
            parent.children.push(f);
          }
        } else {
          parent.children.push(f);
        }
      }
    } else {
      // Root level folder
      if (userInfo.isAdmin) {
        rootFolders.push(f);
      } else {
        const isSystem = f.isSystemFolder || SYSTEM_FOLDER_NAMES.includes(f.name);
        if (isSystem || isCreator) {
          rootFolders.push(f);
        }
      }
    }
  });

  return rootFolders;
};

const softDeleteFolder = async (req, folderId) => {
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: folderId, tenantId, isDeleted: false };
  if (req.user.role !== 'Tenant Admin') {
    query.createdBy = userId;
  }
  const folder = await Folder.findOne(query);
  if (!folder) throw new Error('Folder not found');

  const deletedAt = new Date();
  folder.isDeleted = true;
  folder.deletedAt = deletedAt;
  await folder.save();

  // Recursively delete children
  await recursivelySoftDelete(req, folder._id, deletedAt);

  // Decrement parent totalChildFolders count
  if (folder.parentFolder) {
    await Folder.findByIdAndUpdate(folder.parentFolder, { $inc: { totalChildFolders: -1 } });
  }

  // Create trash log entry
  const trash = new Trash({
    tenantId,
    resourceType: 'Folder',
    resourceId: folder._id,
    deletedBy: userId,
    originalParentId: folder.parentFolder
  });
  await trash.save();

  await activityService.logActivity(req, 'Folder Deleted', 'Folder', folder._id, folder.name);
};

const restoreFolder = async (req, folderId) => {
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  const query = { _id: folderId, tenantId, isDeleted: true };
  if (req.user.role !== 'Tenant Admin') {
    query.createdBy = userId;
  }
  const folder = await Folder.findOne(query);
  if (!folder) throw new Error('Folder not found in Trash');

  // Prevent moving "Trash" folder inside itself
  if (folder.name === 'Trash' && !folder.parentFolder) {
    folder.isDeleted = false;
    folder.deletedAt = null;
    await folder.save();
    await recursivelyRestore(req, folder._id);
    await Trash.deleteOne({ tenantId, resourceType: 'Folder', resourceId: folder._id });
    await activityService.logActivity(req, 'Folder Restored', 'Folder', folder._id, folder.name);
    return;
  }

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
    await activityService.logActivity(req, 'Folder Created', 'Folder', trashFolder._id, trashFolder.name);
  } else if (trashFolder.isDeleted) {
    trashFolder.isDeleted = false;
    trashFolder.deletedAt = null;
    await trashFolder.save();
  }

  folder.parentFolder = trashFolder._id;
  folder.isDeleted = false;
  folder.deletedAt = null;
  await folder.save();

  // Recursively restore children
  await recursivelyRestore(req, folder._id);

  await Folder.findByIdAndUpdate(trashFolder._id, { $inc: { totalChildFolders: 1 } });

  await Trash.deleteOne({ tenantId, resourceType: 'Folder', resourceId: folder._id });

  await activityService.logActivity(req, 'Folder Restored', 'Folder', folder._id, folder.name);
};

const permanentlyDeleteFolder = async (req, folderId) => {
  const Folder = req.Folder;
  const Trash = req.Trash;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: true });
  if (!folder) throw new Error('Folder not found in Trash');

  const folderName = folder.name;

  // Recursively wipe children and release storage
  await recursivelyPermanentDelete(req, folder._id);

  // Wipe the folder itself
  await Folder.findByIdAndDelete(folder._id);

  await Trash.deleteOne({ tenantId, resourceType: 'Folder', resourceId: folder._id });

  await activityService.logActivity(req, 'Folder Permanently Deleted', 'Folder', folder._id, folderName);
};

const downloadZip = async (req, folderId) => {
  const Folder = req.Folder;
  const folder = await Folder.findOne({ _id: folderId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  const zip = new AdmZip();
  await collectZipItems(req, folder._id, folder.name, zip);

  await activityService.logActivity(req, 'Folder Downloaded (ZIP)', 'Folder', folder._id);

  return zip.toBuffer();
};

const toggleFolderLock = async (req, folderId, isLocked) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  folder.isLocked = isLocked;
  await folder.save();

  await activityService.logActivity(req, isLocked ? 'Folder Locked' : 'Folder Unlocked', 'Folder', folder._id);
  return folder;
};

const toggleFolderArchive = async (req, folderId, isArchived) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  folder.isArchived = isArchived;
  await folder.save();

  await activityService.logActivity(req, isArchived ? 'Folder Archived' : 'Folder Restored from Archive', 'Folder', folder._id);
  return folder;
};

const toggleFolderFavorite = async (req, folderId, isFavorite) => {
  const Folder = req.Folder;
  const tenantId = req.user.companySlug;

  const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
  if (!folder) throw new Error('Folder not found');

  folder.isFavorited = isFavorite;
  await folder.save();

  await activityService.logActivity(req, isFavorite ? 'Folder Favorited' : 'Folder Unfavorited', 'Folder', folder._id);
  return folder;
};

module.exports = {
  createFolder,
  getFolderTree,
  ensureDefaultSystemFolders,
  softDeleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
  downloadZip,
  toggleFolderLock,
  toggleFolderArchive,
  toggleFolderFavorite
};
