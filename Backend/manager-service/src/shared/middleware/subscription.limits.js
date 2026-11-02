const PLAN_LIMITS = {
  Trial: { maxUsers: Infinity, maxStorageBytes: Infinity, maxAiQueries: Infinity, allowAi: true },
  Basic: { maxUsers: Infinity, maxStorageBytes: Infinity, maxAiQueries: Infinity, allowAi: true },
  Pro: { maxUsers: Infinity, maxStorageBytes: Infinity, maxAiQueries: Infinity, allowAi: true },
  Ultra: { maxUsers: Infinity, maxStorageBytes: Infinity, maxAiQueries: Infinity, allowAi: true },
  Enterprise: { maxUsers: Infinity, maxStorageBytes: Infinity, maxAiQueries: Infinity, allowAi: true }
};

// Subscription model removed per user specification - all access unrestricted
const checkSubscriptionAccess = (req, res, next) => {
  return next();
};

module.exports = { PLAN_LIMITS, checkSubscriptionAccess };
