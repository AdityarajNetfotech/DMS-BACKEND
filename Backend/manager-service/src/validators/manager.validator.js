const Joi = require('joi');

const createFolderSchema = Joi.object({
  name: Joi.string().required().trim().max(100),
  description: Joi.string().allow('').max(500),
  parentFolder: Joi.string().hex().length(24).allow(null, ''),
  folderColor: Joi.string().trim().max(7).default('#4A90E2'),
  folderIcon: Joi.string().trim().max(30).default('folder')
});

const updateFolderSchema = Joi.object({
  name: Joi.string().trim().max(100),
  description: Joi.string().allow('').max(500),
  folderColor: Joi.string().trim().max(7),
  folderIcon: Joi.string().trim().max(30)
});

const moveFolderSchema = Joi.object({
  targetFolderId: Joi.string().hex().length(24).allow(null, '').required()
});

const updateDocumentSchema = Joi.object({
  name: Joi.string().trim().max(100),
  description: Joi.string().allow('').max(500),
  tags: Joi.array().items(Joi.string().trim().max(50))
});

const lockDocumentSchema = Joi.object({
  isLocked: Joi.boolean().required()
});

const archiveDocumentSchema = Joi.object({
  isArchived: Joi.boolean().required()
});

const favoriteDocumentSchema = Joi.object({
  isFavorite: Joi.boolean().required()
});

const lockFolderSchema = Joi.object({
  isLocked: Joi.boolean().required()
});

const archiveFolderSchema = Joi.object({
  isArchived: Joi.boolean().required()
});

const favoriteFolderSchema = Joi.object({
  isFavorite: Joi.boolean().required()
});

const copyMoveDocumentSchema = Joi.object({
  targetFolderId: Joi.string().hex().length(24).allow(null, '').required()
});

const createDocumentShareSchema = Joi.object({
  expiryDate: Joi.date().allow(null),
  password: Joi.string().min(4).allow(null, ''),
  isPasswordProtected: Joi.boolean().default(false),
  sharingType: Joi.string().valid('Internal', 'External').default('External'),
  permissions: Joi.object({
    readOnly: Joi.boolean().default(true),
    download: Joi.boolean().default(true)
  }).default(),
  sharedWithViewers: Joi.array().items(Joi.string().hex().length(24)).allow(null)
});

const createFolderShareSchema = Joi.object({
  expiryDate: Joi.date().allow(null),
  password: Joi.string().min(4).allow(null, ''),
  isPasswordProtected: Joi.boolean().default(false),
  sharingType: Joi.string().valid('Internal', 'External').default('External'),
  permissions: Joi.object({
    readOnly: Joi.boolean().default(true),
    download: Joi.boolean().default(true),
    uploadAllowed: Joi.boolean().default(false)
  }).default(),
  sharedWithViewers: Joi.array().items(Joi.string().hex().length(24)).allow(null)
});

const createShareSchema = createDocumentShareSchema;

module.exports = {
  createFolderSchema,
  updateFolderSchema,
  moveFolderSchema,
  updateDocumentSchema,
  lockDocumentSchema,
  archiveDocumentSchema,
  favoriteDocumentSchema,
  copyMoveDocumentSchema,
  createShareSchema,
  createDocumentShareSchema,
  createFolderShareSchema,
  lockFolderSchema,
  archiveFolderSchema,
  favoriteFolderSchema
};
