const PLAN_LIMITS = {
  Trial: {
    maxUsers: 3,
    maxStorageBytes: 500 * 1024 * 1024, // 500 MB
    maxAiQueries: 5,
    allowAi: true
  },
  Basic: {
    maxUsers: 10,
    maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    maxAiQueries: 0,
    allowAi: false
  },
  Pro: {
    maxUsers: 50,
    maxStorageBytes: 25 * 1024 * 1024 * 1024, // 25 GB
    maxAiQueries: 100,
    allowAi: true
  },
  Ultra: {
    maxUsers: Infinity,
    maxStorageBytes: 500 * 1024 * 1024 * 1024, // 500 GB
    maxAiQueries: Infinity,
    allowAi: true
  }
};

const checkSubscriptionAccess = (req, res, next) => {
  const tenant = req.tenant;
  if (!tenant) return next();

  const now = new Date();
  const plan = tenant.subscription?.plan || 'Trial';
  const trialEnded = tenant.trialEndsAt && new Date(tenant.trialEndsAt) < now;
  const planExpired = tenant.subscription?.expiresAt && new Date(tenant.subscription.expiresAt) < now;

  if ((plan === 'Trial' && trialEnded) || (plan !== 'Trial' && planExpired)) {
    return res.status(402).json({
      success: false,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Subscription plan or 7-day trial has expired. Please upgrade your plan to continue.',
      trialEndsAt: tenant.trialEndsAt,
      subscription: tenant.subscription
    });
  }

  next();
};

module.exports = { PLAN_LIMITS, checkSubscriptionAccess };
