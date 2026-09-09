const logger = require('../config/logger');

const logActivity = async (req, action, resource, resourceId, resourceName = '', details = {}) => {
  try {
    const ActivityLog = req.ActivityLog;
    if (!ActivityLog) return;

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Basic User Agent parser
    let browser = 'Unknown';
    let operatingSystem = 'Unknown';

    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Edge')) browser = 'Edge';

    if (userAgent.includes('Windows')) operatingSystem = 'Windows';
    else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) operatingSystem = 'macOS';
    else if (userAgent.includes('Linux')) operatingSystem = 'Linux';
    else if (userAgent.includes('Android')) operatingSystem = 'Android';
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) operatingSystem = 'iOS';

    const userId = req.user?.userId || req.user?._id;
    const tenantId = req.user?.companySlug || req.tenant?.companySlug || req.params?.companySlug;

    const log = new ActivityLog({
      managerId: userId,
      tenantId,
      action,
      resource,
      resourceId: resourceId || null,
      resourceName: resourceName || '',
      details: details || {},
      ipAddress,
      browser,
      operatingSystem
    });

    await log.save();
    logger.info(`Activity logged: ${action} on ${resource} (${resourceName || resourceId}) by user ${userId}`);
  } catch (error) {
    logger.error('Failed to save activity log:', error);
  }
};

module.exports = {
  logActivity
};
