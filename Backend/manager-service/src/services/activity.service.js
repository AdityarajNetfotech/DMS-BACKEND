const logger = require('../config/logger');

const logActivity = async (req, action, resource, resourceId) => {
  try {
    const ActivityLog = req.ActivityLog;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Basic User Agent parser
    let browser = 'Unknown';
    let operatingSystem = 'Unknown';

    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';

    if (userAgent.includes('Windows')) operatingSystem = 'Windows';
    else if (userAgent.includes('Macintosh')) operatingSystem = 'macOS';
    else if (userAgent.includes('Linux')) operatingSystem = 'Linux';

    const log = new ActivityLog({
      managerId: req.user.userId,
      tenantId: req.user.companySlug,
      action,
      resource,
      resourceId,
      ipAddress,
      browser,
      operatingSystem
    });

    await log.save();
    logger.info(`Activity logged: ${action} on ${resource} (${resourceId})`);
  } catch (error) {
    logger.error('Failed to save activity log:', error);
  }
};

module.exports = {
  logActivity
};
