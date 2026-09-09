const mongoose = require('mongoose');

const getActivityLogs = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const ActivityLog = req.ActivityLog;
    const User = req.User;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const { search, action, resource, userId, startDate, endDate } = req.query;

    const filter = { tenantId };

    // Scoping: If not Tenant Admin or Manager viewing team logs, filter by user
    if (req.user.role !== 'Tenant Admin' && req.user.role !== 'Company Admin' && req.query.selfOnly === 'true') {
      filter.managerId = req.user.userId;
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      filter.managerId = userId;
    }

    // Action filter
    if (action && action !== 'ALL') {
      if (action === 'DELETIONS') {
        filter.action = { $regex: /delete|deleted/i };
      } else if (action === 'LOGINS') {
        filter.action = { $regex: /login|logout/i };
      } else if (action === 'UPLOADS') {
        filter.action = { $regex: /upload/i };
      } else if (action === 'UPDATES') {
        filter.action = { $regex: /update|edit/i };
      } else if (action === 'SHARES') {
        filter.action = { $regex: /share/i };
      } else {
        filter.action = action;
      }
    }

    // Resource filter
    if (resource && resource !== 'ALL') {
      filter.resource = resource;
    }

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    // Search filter (by resourceName, ipAddress, or action)
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { resourceName: regex },
        { action: regex },
        { ipAddress: regex }
      ];
    }

    // Summary counts
    const totalLogs = await ActivityLog.countDocuments(filter);
    const totalDeletions = await ActivityLog.countDocuments({ tenantId, action: { $regex: /delete/i } });
    const totalLogins = await ActivityLog.countDocuments({ tenantId, action: { $regex: /login/i } });
    const totalUploads = await ActivityLog.countDocuments({ tenantId, action: { $regex: /upload/i } });

    // Fetch paginated logs
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('managerId', 'name email role departmentId');

    res.status(200).json({
      success: true,
      message: 'Activity logs retrieved successfully.',
      data: {
        logs,
        pagination: {
          total: totalLogs,
          page,
          limit,
          totalPages: Math.ceil(totalLogs / limit)
        },
        stats: {
          totalLogs,
          totalDeletions,
          totalLogins,
          totalUploads
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

const exportActivityLogs = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const ActivityLog = req.ActivityLog;

    const { search, action, resource, userId, startDate, endDate } = req.query;
    const filter = { tenantId };

    if (req.user.role !== 'Tenant Admin' && req.user.role !== 'Company Admin' && req.query.selfOnly === 'true') {
      filter.managerId = req.user.userId;
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      filter.managerId = userId;
    }

    if (action && action !== 'ALL') {
      if (action === 'DELETIONS') {
        filter.action = { $regex: /delete|deleted/i };
      } else if (action === 'LOGINS') {
        filter.action = { $regex: /login|logout/i };
      } else if (action === 'UPLOADS') {
        filter.action = { $regex: /upload/i };
      } else if (action === 'UPDATES') {
        filter.action = { $regex: /update|edit/i };
      } else if (action === 'SHARES') {
        filter.action = { $regex: /share/i };
      } else {
        filter.action = action;
      }
    }

    if (resource && resource !== 'ALL') {
      filter.resource = resource;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { resourceName: regex },
        { action: regex },
        { ipAddress: regex }
      ];
    }

    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .populate('managerId', 'name email role');

    const headers = [
      'Timestamp',
      'User Name',
      'User Email',
      'User Role',
      'Action',
      'Resource Type',
      'Resource Name',
      'IP Address',
      'Browser',
      'Operating System',
      'Details'
    ];

    const rows = logs.map(l => {
      const user = l.managerId || {};
      const detailsStr = l.details ? JSON.stringify(l.details) : '';
      return [
        l.createdAt ? new Date(l.createdAt).toISOString() : '',
        user.name || 'System / User',
        user.email || '—',
        user.role || '—',
        l.action || '—',
        l.resource || '—',
        l.resourceName || String(l.resourceId || '—'),
        l.ipAddress || '—',
        l.browser || '—',
        l.operatingSystem || '—',
        detailsStr
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row =>
        row.map(val => {
          const str = String(val ?? '').replace(/"/g, '""');
          return str.includes(',') || str.includes('\n') || str.includes('"') ? `"${str}"` : str;
        }).join(',')
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${tenantId}_${Date.now()}.csv"`);
    res.status(200).send('\uFEFF' + csvContent);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getActivityLogs,
  exportActivityLogs
};
