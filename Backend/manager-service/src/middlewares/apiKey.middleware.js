const mongoose = require('mongoose');
const apiKeySchema = require('../models/apiKey.model');

/**
 * Middleware to authenticate requests from external systems (LOS, CBS, CRM)
 * via header X-DMS-API-Key or Bearer API Key.
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    const rawKey = req.headers['x-dms-api-key'] || req.headers['x-api-key'] || (
      req.headers['authorization']?.startsWith('Bearer dms_') ? req.headers['authorization'].split(' ')[1] : null
    );

    if (!rawKey) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Missing external system API Key. Please provide X-DMS-API-Key header.'
      });
    }

    // Default global demo/master API key for testing
    const defaultMasterKey = process.env.DMS_INGESTION_MASTER_KEY || 'dms_los_ingest_master_key_2026';
    if (rawKey === defaultMasterKey) {
      req.externalSystem = {
        systemName: 'Master Ingestion Client (LOS/CBS)',
        tenantId: req.headers['x-tenant-id'] || 'default',
        permissions: ['document:ingest', 'document:read']
      };
      return next();
    }

    // Look up in tenant DB if tenantResolver resolved it
    if (req.tenantDb) {
      const ApiKeyModel = req.tenantDb.models.ApiKey || req.tenantDb.model('ApiKey', apiKeySchema);
      const keyDoc = await ApiKeyModel.findOne({ apiKey: rawKey, isActive: true });

      if (keyDoc) {
        keyDoc.lastUsedAt = new Date();
        await keyDoc.save();
        req.externalSystem = keyDoc;
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      message: 'Forbidden: Invalid or revoked API Key.'
    });
  } catch (err) {
    next(err);
  }
};

module.exports = authenticateApiKey;
