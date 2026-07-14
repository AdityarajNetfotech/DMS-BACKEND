const express = require('express');
const router = express.Router({ mergeParams: true });
const Tenant = require('../shared/models/tenant.model');
const { authenticate, authorizeRoles } = require('../shared/auth.middleware');
const cloudinary = require('../config/cloudinary');

// GET branding (Public)
router.get('/', async (req, res, next) => {
  try {
    const { companySlug } = req.params;
    const tenant = await Tenant.findOne({ companySlug });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        companyName: tenant.companyName,
        logo: tenant.logo || '',
        primaryColor: tenant.primaryColor || '#0B2C87',
        fontFamily: tenant.fontFamily || 'Inter',
        defaultLanguage: tenant.defaultLanguage || 'English'
      }
    });
  } catch (err) {
    next(err);
  }
});

// PUT branding (Tenant Admin only)
router.put('/', authenticate, authorizeRoles('Tenant Admin'), async (req, res, next) => {
  try {
    const { companySlug } = req.params;
    const { logo, primaryColor, fontFamily, defaultLanguage } = req.body;

    const tenant = await Tenant.findOne({ companySlug });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    if (logo && logo.startsWith('data:image/')) {
      try {
        const uploadRes = await cloudinary.uploader.upload(logo, {
          folder: 'tenant_branding_logos',
          resource_type: 'image'
        });
        tenant.logo = uploadRes.secure_url;
      } catch (err) {
        console.error('Cloudinary logo upload error:', err);
        return res.status(500).json({ success: false, message: 'Failed to upload logo to Cloudinary' });
      }
    } else if (logo !== undefined) {
      tenant.logo = logo;
    }

    if (primaryColor !== undefined) tenant.primaryColor = primaryColor;
    if (fontFamily !== undefined) tenant.fontFamily = fontFamily;
    if (defaultLanguage !== undefined) tenant.defaultLanguage = defaultLanguage;

    await tenant.save();

    res.status(200).json({
      success: true,
      message: 'Workspace branding updated successfully',
      data: {
        companyName: tenant.companyName,
        logo: tenant.logo,
        primaryColor: tenant.primaryColor,
        fontFamily: tenant.fontFamily,
        defaultLanguage: tenant.defaultLanguage
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
