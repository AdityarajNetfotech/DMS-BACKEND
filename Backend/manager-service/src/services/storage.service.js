const logger = require('../config/logger');

const getStorageLimitByPlan = (plan) => {
  switch (plan) {
    case 'Trial': return 500 * 1024 * 1024; // 500 MB
    case 'Basic': return 5 * 1024 * 1024 * 1024; // 5 GB
    case 'Pro': return 25 * 1024 * 1024 * 1024; // 25 GB
    case 'Ultra': return 500 * 1024 * 1024 * 1024; // 500 GB
    default: return 500 * 1024 * 1024; // fallback to Trial
  }
};

const checkAndIncrementStorage = async (req, fileSize) => {
  const Storage = req.Storage;
  const Notification = req.Notification;
  const tenantId = req.user.companySlug;
  const userId = req.user.userId;

  // Find or create storage allocation mapping for the tenant
  let storage = await Storage.findOne({ tenantId });
  if (!storage) {
    storage = new Storage({ tenantId });
  }

  // Update storage limit dynamically based on plan
  const plan = req.tenant?.subscription?.plan || 'Trial';
  storage.maxStorageLimit = getStorageLimitByPlan(plan);
  await storage.save();

  const newUsed = storage.totalStorageUsed + fileSize;
  if (newUsed > storage.maxStorageLimit) {
    throw new Error(`Storage limit exceeded. Your plan limit is ${plan === 'Trial' ? '500 MB' : plan === 'Basic' ? '5 GB' : plan === 'Pro' ? '25 GB' : '500 GB'}.`);
  }

  // Update storage limit count
  storage.totalStorageUsed = newUsed;
  await storage.save();

  // Storage warning threshold (90% usage alert trigger)
  const threshold = 0.9 * storage.maxStorageLimit;
  if (newUsed >= threshold) {
    const usagePercentage = Math.round((newUsed / storage.maxStorageLimit) * 100);
    
    // Check if warning was already triggered recently to avoid spamming
    const lastWarning = await Notification.findOne({
      userId,
      tenantId,
      type: 'StorageWarning',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // last 24h
    });

    if (!lastWarning) {
      const warning = new Notification({
        userId,
        tenantId,
        title: 'Storage warning: 90% reached',
        message: `Your tenant space is running out of storage. Currently using ${usagePercentage}% (${Math.round(newUsed / (1024 * 1024))} MB / ${Math.round(storage.maxStorageLimit / (1024 * 1024))} MB).`,
        type: 'StorageWarning'
      });
      await warning.save();
      logger.warn(`Storage warning notification created for tenant: ${tenantId}`);
    }
  }

  return storage;
};

const decrementStorage = async (req, fileSize) => {
  const Storage = req.Storage;
  const tenantId = req.user.companySlug;

  const storage = await Storage.findOne({ tenantId });
  if (storage) {
    storage.totalStorageUsed = Math.max(0, storage.totalStorageUsed - fileSize);
    await storage.save();
  }
};

const getStorageUsage = async (req) => {
  const Storage = req.Storage;
  const tenantId = req.user.companySlug;

  let storage = await Storage.findOne({ tenantId });
  if (!storage) {
    storage = new Storage({ tenantId });
  }

  const plan = req.tenant?.subscription?.plan || 'Trial';
  storage.maxStorageLimit = getStorageLimitByPlan(plan);
  await storage.save();

  return {
    totalStorageUsed: storage.totalStorageUsed,
    maxStorageLimit: storage.maxStorageLimit,
    remainingStorage: Math.max(0, storage.maxStorageLimit - storage.totalStorageUsed)
  };
};

module.exports = {
  checkAndIncrementStorage,
  decrementStorage,
  getStorageUsage
};
