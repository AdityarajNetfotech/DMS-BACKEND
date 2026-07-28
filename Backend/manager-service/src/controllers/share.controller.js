const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const activityService = require('../services/activity.service');
const { createDocumentShareSchema, createFolderShareSchema } = require('../validators/manager.validator');

const createShareLink = async (req, res, next) => {
  try {
    const { error, value } = createDocumentShareSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const Share = req.Share;
    const Document = req.Document;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const { documentId } = req.params;

    const doc = await Document.findOne({ _id: documentId, tenantId, isDeleted: false });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const shareToken = crypto.randomBytes(16).toString('hex');
    const shareLink = `${process.env.BACKEND_URL}/api/${tenantId}/manager/shares/resolve/${shareToken}`;

    const { expiryDate, password, isPasswordProtected, sharingType, permissions, sharedWithViewers } = value;

    const share = new Share({
      tenantId,
      documentId,
      sharedBy: userId,
      shareLink: shareToken,
      expiryDate,
      password: password || null,
      isPasswordProtected: isPasswordProtected || !!password,
      sharingType,
      permissions,
      sharedWithViewers: sharedWithViewers || []
    });

    await share.save();

    await activityService.logActivity(req, 'Document Shared', 'Document', doc._id);

    res.status(201).json({
      success: true,
      message: 'Share link created successfully.',
      data: {
        shareLink,
        shareToken,
        expiryDate,
        isPasswordProtected: share.isPasswordProtected,
        sharingType
      },
      errors: null
    });
  } catch (err) { next(err); }
};

const createFolderShareLink = async (req, res, next) => {
  try {
    const { error, value } = createFolderShareSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message, errors: error.details });
    }

    const Share = req.Share;
    const Folder = req.Folder;
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const { folderId } = req.params;

    const folder = await Folder.findOne({ _id: folderId, tenantId, isDeleted: false });
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const { expiryDate, password, isPasswordProtected, sharingType, permissions, sharedWithViewers } = value;

    const shareToken = crypto.randomBytes(16).toString('hex');
    const shareLink = `${process.env.BACKEND_URL}/api/${tenantId}/manager/shares/resolve/${shareToken}`;

    const share = new Share({
      tenantId,
      folderId,
      documentId: null,
      sharedBy: userId,
      shareLink: shareToken,
      expiryDate,
      password: password || null,
      isPasswordProtected: isPasswordProtected || !!password,
      sharingType,
      permissions,
      sharedWithViewers: sharedWithViewers || []
    });

    await share.save();
    await activityService.logActivity(req, 'Folder Shared', 'Folder', folder._id);

    // Send email notifications to internally shared Viewers if upload is allowed
    if (sharingType === 'Internal' && permissions && permissions.uploadAllowed === true && sharedWithViewers && sharedWithViewers.length > 0) {
      try {
        const manager = await req.User.findById(userId).select('name');
        const managerName = manager ? manager.name : 'A Manager';
        const viewers = await req.User.find({ _id: { $in: sharedWithViewers } }).select('email name');
        const EMAIL_URL = process.env.EMAIL_SERVICE_URL || 'http://email-service:3005';
        const companyName = req.user.companyName || 'DMS Platform';
        const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/${tenantId}/login`;

        for (const viewer of viewers) {
          fetch(`${EMAIL_URL}/api/email/folder-shared-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: viewer.email,
              managerName,
              folderName: folder.name,
              companyName,
              portalUrl
            })
          }).catch(err => console.error(`Failed to send email to ${viewer.email}:`, err));
        }
      } catch (emailErr) {
        console.error('Failed to trigger email notifications:', emailErr);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Folder share link created successfully.',
      data: {
        shareLink,
        shareToken,
        expiryDate,
        isPasswordProtected: share.isPasswordProtected,
        sharingType
      },
      errors: null
    });
  } catch (err) { next(err); }
};


const resolveShareLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query; // Accept password in query parameter
    const Share = req.Share;
    const Document = req.Document;
    const Folder = req.Folder;

    const share = await Share.findOne({ shareLink: token });
    if (!share) return res.status(404).json({ success: false, message: 'Share link not found' });

    // Expiry check
    if (share.expiryDate && new Date(share.expiryDate) < new Date()) {
      return res.status(410).json({ success: false, message: 'Share link has expired' });
    }

    // Password validation
    if (share.isPasswordProtected) {
      if (!password) {
        return res.status(401).json({
          success: false,
          message: 'Password required to access this file',
          data: { isPasswordProtected: true },
          errors: null
        });
      }
      const isMatch = await share.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid password provided' });
      }
    }

    // Handle shared folders
    if (share.folderId) {
      const folder = await Folder.findById(share.folderId);
      if (!folder || folder.isDeleted) {
        return res.status(404).json({ success: false, message: 'Folder is no longer available' });
      }
      return res.status(200).json({
        success: true,
        message: 'Shared folder resolved successfully.',
        data: { folder, permissions: share.permissions, type: 'folder' },
        errors: null
      });
    }

    // Handle shared documents — redirect to the actual file
    const doc = await Document.findById(share.documentId).select('-password');
    if (!doc || doc.isDeleted) {
      return res.status(404).json({ success: false, message: 'Document is no longer available' });
    }

    // Redirect the user directly to the file URL so they see the actual file
    return res.redirect(doc.storageUrl);
  } catch (err) { next(err); }
};

const downloadSharedFile = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query;
    const Share = req.Share;
    const Document = req.Document;

    const share = await Share.findOne({ shareLink: token });
    if (!share) return res.status(404).json({ success: false, message: 'Share link not found' });

    if (share.expiryDate && new Date(share.expiryDate) < new Date()) {
      return res.status(410).json({ success: false, message: 'Share link has expired' });
    }

    if (!share.permissions.download) {
      return res.status(403).json({ success: false, message: 'Download permission is disabled for this link' });
    }

    if (share.isPasswordProtected) {
      if (!password) return res.status(401).json({ success: false, message: 'Password required' });
      const isMatch = await share.comparePassword(password);
      if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const doc = await Document.findById(share.documentId);
    if (!doc || doc.isDeleted) return res.status(404).json({ success: false, message: 'Document is not available' });

    doc.downloadCount += 1;
    await doc.save();

    if (doc.storageUrl.startsWith('/uploads')) {
      const filePath = path.join(__dirname, '../../', doc.storageUrl);
      if (fs.existsSync(filePath)) {
        return res.download(filePath, doc.originalFileName);
      }
      return res.status(404).json({ success: false, message: 'File asset not found locally' });
    } else {
      return res.redirect(doc.storageUrl);
    }
  } catch (err) { next(err); }
};

const getSharedItems = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const userId = req.user.userId;
    const userRole = req.user.role;
    const Share = req.Share;

    const query = { tenantId };
    if (userRole !== 'Tenant Admin') {
      query.$or = [
        { sharedBy: userId },
        { sharedWithViewers: new (require('mongoose').Types.ObjectId)(userId) }
      ];
    }

    // Ensure User model is available for populate (registered by tenantResolver)
    const shares = await Share.find(query)
      .populate('documentId', 'originalFileName fileType fileSize name storageUrl')
      .populate('folderId', 'name')
      .populate({ path: 'sharedBy', model: req.User, select: 'name email' })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: 'Shared items fetched successfully.',
      data: shares,
      errors: null
    });
  } catch (err) { next(err); }
};

module.exports = {
  createShareLink,
  createFolderShareLink,
  resolveShareLink,
  downloadSharedFile,
  getSharedItems
};
