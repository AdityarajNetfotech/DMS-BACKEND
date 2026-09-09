const activityService = require('../services/activity.service');
const signatureService = require('../services/signature.service');

/**
 * GET /api/:companySlug/manager/approvals
 * Lists documents for approval based on user role
 */
const listPendingApprovals = async (req, res, next) => {
  try {
    const Document = req.Document;
    const Folder = req.Folder;
    const tenantId = req.user.companySlug;
    const userRole = req.user.role;
    const userId = req.user.userId;

    const { status = 'pending', category, search } = req.query;

    const query = { tenantId, isDeleted: false };

    // Role-based filtering
    if (userRole === 'Reporting Manager') {
      if (status === 'pending') {
        query.$and = [
          {
            $or: [
              { 'approvalWorkflow.reportingApproval.status': 'Pending' },
              { approvalStatus: { $in: ['Pending_Reporting_Approval', 'Pending_Dual_Approval', 'Pending'] } },
              { approvalStatus: { $exists: false } },
              { approvalStatus: null },
              { approvalStatus: '' }
            ]
          },
          { approvalStatus: { $nin: ['Approved', 'Rejected'] } }
        ];
      } else if (status === 'approved') {
        query.$or = [
          { 'approvalWorkflow.reportingApproval.status': 'Approved' },
          { approvalStatus: 'Approved' }
        ];
      } else if (status === 'rejected') {
        query.$or = [
          { 'approvalWorkflow.reportingApproval.status': 'Rejected' },
          { approvalStatus: 'Rejected' }
        ];
      }
      // If status === 'all', query all tenant non-deleted documents
    } else if (userRole === 'Legal Team') {
      const legalFolders = await Folder.find({
        tenantId,
        isDeleted: false,
        $or: [
          { folderCategory: 'Legal' },
          { name: { $regex: /legal/i } }
        ]
      }).select('_id');
      const legalFolderIds = legalFolders.map(f => f._id);

      const legalScope = {
        $or: [
          { folderId: { $in: legalFolderIds } },
          { 'approvalWorkflow.requiresLegal': true },
          { approvalStatus: 'Pending_Legal_Approval' }
        ]
      };

      if (status === 'pending') {
        query.$and = [
          legalScope,
          {
            $or: [
              { 'approvalWorkflow.legalApproval.status': 'Pending' },
              { approvalStatus: { $in: ['Pending_Legal_Approval', 'Pending_Dual_Approval'] } }
            ]
          },
          { approvalStatus: { $nin: ['Approved', 'Rejected'] } }
        ];
      } else if (status === 'approved') {
        query.$and = [
          legalScope,
          {
            $or: [
              { 'approvalWorkflow.legalApproval.status': 'Approved' },
              { approvalStatus: 'Approved' }
            ]
          }
        ];
      } else if (status === 'rejected') {
        query.$and = [
          legalScope,
          {
            $or: [
              { 'approvalWorkflow.legalApproval.status': 'Rejected' },
              { approvalStatus: 'Rejected' }
            ]
          }
        ];
      } else {
        query.$and = [legalScope];
      }
    } else if (userRole === 'Compliance Team') {
      const complianceFolders = await Folder.find({
        tenantId,
        isDeleted: false,
        $or: [
          { folderCategory: 'Compliance' },
          { name: { $regex: /compliance/i } }
        ]
      }).select('_id');
      const complianceFolderIds = complianceFolders.map(f => f._id);

      const complianceScope = {
        $or: [
          { folderId: { $in: complianceFolderIds } },
          { 'approvalWorkflow.requiresCompliance': true },
          { approvalStatus: 'Pending_Compliance_Approval' }
        ]
      };

      if (status === 'pending') {
        query.$and = [
          complianceScope,
          {
            $or: [
              { 'approvalWorkflow.complianceApproval.status': 'Pending' },
              { approvalStatus: { $in: ['Pending_Compliance_Approval', 'Pending_Dual_Approval'] } }
            ]
          },
          { approvalStatus: { $nin: ['Approved', 'Rejected'] } }
        ];
      } else if (status === 'approved') {
        query.$and = [
          complianceScope,
          {
            $or: [
              { 'approvalWorkflow.complianceApproval.status': 'Approved' },
              { approvalStatus: 'Approved' }
            ]
          }
        ];
      } else if (status === 'rejected') {
        query.$and = [
          complianceScope,
          {
            $or: [
              { 'approvalWorkflow.complianceApproval.status': 'Rejected' },
              { approvalStatus: 'Rejected' }
            ]
          }
        ];
      } else {
        query.$and = [complianceScope];
      }
    } else if (userRole === 'Manager') {
      // Manager views their own submissions
      query.uploadedBy = userId;
      if (status === 'pending') {
        query.approvalStatus = { $in: ['Pending_Reporting_Approval', 'Pending_Legal_Approval', 'Pending_Compliance_Approval', 'Pending_Dual_Approval', 'Pending'] };
      } else if (status === 'approved') {
        query.approvalStatus = 'Approved';
      } else if (status === 'rejected') {
        query.approvalStatus = 'Rejected';
      }
    } else {
      // Tenant Admin / Company Admin / Super Admin
      if (status === 'pending') {
        query.approvalStatus = { $in: ['Pending_Reporting_Approval', 'Pending_Legal_Approval', 'Pending_Compliance_Approval', 'Pending_Dual_Approval', 'Pending'] };
      } else if (status === 'approved') {
        query.approvalStatus = 'Approved';
      } else if (status === 'rejected') {
        query.approvalStatus = 'Rejected';
      }
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerRef: { $regex: search, $options: 'i' } },
        { documentType: { $regex: search, $options: 'i' } }
      ];
    }

    const documents = await Document.find(query)
      .populate('uploadedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('folderId', 'name folderCategory isSystemFolder')
      .populate('approvalWorkflow.legalApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.complianceApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .populate('approvalWorkflow.reportingApproval.approvedBy', 'name email role signature signatureType signatureFont signatureInitials')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: documents,
      count: documents.length
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/:companySlug/manager/approvals/:id/decision
 * Approves or Rejects a document
 */
const makeApprovalDecision = async (req, res, next) => {
  try {
    const Document = req.Document;
    const tenantId = req.user.companySlug;
    const userRole = req.user.role;
    const userId = req.user.userId;
    const docId = req.params.id;

    const action = req.body.action || req.body.decision; // Support both 'action' and 'decision'
    const comments = req.body.comments || req.body.remarks || ''; // Support both 'comments' and 'remarks'

    if (!['Approve', 'Reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be Approve or Reject' });
    }

    const doc = await Document.findOne({ _id: docId, tenantId, isDeleted: false });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Ensure workflow object exists
    if (!doc.approvalWorkflow) {
      doc.approvalWorkflow = {
        requiresLegal: false,
        requiresCompliance: false,
        requiresReporting: true,
        legalApproval: { status: 'Not_Required' },
        complianceApproval: { status: 'Not_Required' },
        reportingApproval: { status: 'Pending' }
      };
    }

    const wf = doc.approvalWorkflow;
    let handled = false;
    let approvedRole = '';

    // 1. Legal Team Decision
    if (userRole === 'Legal Team' || userRole === 'Tenant Admin' || userRole === 'Company Admin') {
      if (wf.requiresLegal && (wf.legalApproval?.status === 'Pending' || !wf.legalApproval?.status)) {
        wf.legalApproval.status = action === 'Approve' ? 'Approved' : 'Rejected';
        wf.legalApproval.approvedBy = userId;
        wf.legalApproval.approvedAt = new Date();
        wf.legalApproval.comments = comments || (action === 'Approve' ? 'Approved by Legal Team' : 'Rejected by Legal Team');
        handled = true;
        approvedRole = 'Legal Manager';
      }
    }

    // 2. Compliance Team Decision
    if (userRole === 'Compliance Team' || userRole === 'Tenant Admin' || userRole === 'Company Admin') {
      if (wf.requiresCompliance && (wf.complianceApproval?.status === 'Pending' || !wf.complianceApproval?.status)) {
        wf.complianceApproval.status = action === 'Approve' ? 'Approved' : 'Rejected';
        wf.complianceApproval.approvedBy = userId;
        wf.complianceApproval.approvedAt = new Date();
        wf.complianceApproval.comments = comments || (action === 'Approve' ? 'Approved by Compliance Team' : 'Rejected by Compliance Team');
        handled = true;
        approvedRole = 'Compliance Manager';
      }
    }

    // 3. Reporting Manager Decision
    if (userRole === 'Reporting Manager' || userRole === 'Tenant Admin' || userRole === 'Company Admin') {
      if (wf.requiresReporting !== false && (wf.reportingApproval?.status === 'Pending' || !wf.reportingApproval?.status || wf.reportingApproval?.status === 'Not_Required')) {
        wf.reportingApproval.status = action === 'Approve' ? 'Approved' : 'Rejected';
        wf.reportingApproval.approvedBy = userId;
        wf.reportingApproval.approvedAt = new Date();
        wf.reportingApproval.comments = comments || (action === 'Approve' ? 'Approved by Reporting Manager' : 'Rejected by Reporting Manager');
        handled = true;
        approvedRole = 'Reporting Manager';
      }
    }

    if (!handled && userRole !== 'Tenant Admin' && userRole !== 'Company Admin') {
      return res.status(403).json({
        success: false,
        message: `Your role (${userRole}) is not currently a pending approver for this document.`
      });
    }

    // Calculate Final Overall Approval Status
    const isAnyRejected = (wf.requiresLegal && wf.legalApproval?.status === 'Rejected') ||
      (wf.requiresCompliance && wf.complianceApproval?.status === 'Rejected') ||
      (wf.requiresReporting !== false && wf.reportingApproval?.status === 'Rejected');

    if (isAnyRejected || action === 'Reject') {
      doc.approvalStatus = 'Rejected';
      doc.rejectionReason = comments || 'Rejected during review.';
    } else {
      const legalOk = !wf.requiresLegal || wf.legalApproval?.status === 'Approved';
      const compOk = !wf.requiresCompliance || wf.complianceApproval?.status === 'Approved';
      const repOk = wf.requiresReporting === false || wf.reportingApproval?.status === 'Approved';

      if (legalOk && compOk && repOk) {
        doc.approvalStatus = 'Approved';
        doc.rejectionReason = '';
      } else {
        // Multi-level pending status
        if (wf.requiresLegal && wf.legalApproval?.status === 'Pending' && wf.reportingApproval?.status === 'Pending') {
          doc.approvalStatus = 'Pending_Dual_Approval';
        } else if (wf.requiresLegal && wf.legalApproval?.status === 'Pending') {
          doc.approvalStatus = 'Pending_Legal_Approval';
        } else if (wf.requiresCompliance && wf.complianceApproval?.status === 'Pending' && wf.reportingApproval?.status === 'Pending') {
          doc.approvalStatus = 'Pending_Dual_Approval';
        } else if (wf.requiresCompliance && wf.complianceApproval?.status === 'Pending') {
          doc.approvalStatus = 'Pending_Compliance_Approval';
        } else if (wf.reportingApproval?.status === 'Pending') {
          doc.approvalStatus = 'Pending_Reporting_Approval';
        }
      }
    }

    // If action is Approve, fetch approver's profile E-Signature and stamp the last page
    if (action === 'Approve') {
      let approverUser = null;
      try {
        if (req.User && userId) {
          approverUser = await req.User.findById(userId);
        }
      } catch (uErr) {
        console.warn('Could not fetch approver user profile for signature:', uErr.message);
      }

      if (!approverUser) {
        approverUser = {
          _id: userId,
          name: req.user.name || userRole,
          email: req.user.email || '',
          signature: '',
          signatureType: 'draw',
          signatureFont: 'Great Vibes'
        };
      }

      // Synchronize multi-party signature slots with approver's profile signature & workflow
      doc.signatures = await signatureService.syncDocumentSignatures(
        doc,
        req,
        approverUser,
        approvedRole || userRole,
        comments
      );
      doc.markModified('signatures');

      // Re-stamp PDF document's last page with the new signature
      try {
        await signatureService.reStampDocumentFile(doc, doc.signatures);
      } catch (stampErr) {
        console.error('PDF re-stamping error during approval (non-blocking):', stampErr.message);
      }
    }

    doc.markModified('approvalWorkflow');
    await doc.save();


    await activityService.logActivity(
      req,
      action === 'Approve' ? 'Document Approved' : 'Document Rejected',
      'Document',
      doc._id,
      doc.name,
      { comments, status: doc.approvalStatus }
    );

    return res.status(200).json({
      success: true,
      message: `Document has been successfully ${action.toLowerCase()}d.`,
      data: doc
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/:companySlug/manager/approvals/stats
 * Summary stats for header badges and KPI cards
 */
const getApprovalStats = async (req, res, next) => {
  try {
    const Document = req.Document;
    const Folder = req.Folder;
    const tenantId = req.user.companySlug;
    const userRole = req.user.role;
    const userId = req.user.userId;

    const baseQuery = { tenantId, isDeleted: false };
    if (userRole === 'Manager') {
      baseQuery.uploadedBy = userId;
    }

    let pendingAction = 0;
    let approved = 0;
    let rejected = 0;
    let total = 0;

    if (userRole === 'Reporting Manager') {
      pendingAction = await Document.countDocuments({
        ...baseQuery,
        $and: [
          {
            $or: [
              { 'approvalWorkflow.reportingApproval.status': 'Pending' },
              { approvalStatus: { $in: ['Pending_Reporting_Approval', 'Pending_Dual_Approval', 'Pending'] } },
              { approvalStatus: { $exists: false } },
              { approvalStatus: null },
              { approvalStatus: '' }
            ]
          },
          { approvalStatus: { $nin: ['Approved', 'Rejected'] } }
        ]
      });

      approved = await Document.countDocuments({
        ...baseQuery,
        $or: [
          { 'approvalWorkflow.reportingApproval.status': 'Approved' },
          { approvalStatus: 'Approved' }
        ]
      });

      rejected = await Document.countDocuments({
        ...baseQuery,
        $or: [
          { 'approvalWorkflow.reportingApproval.status': 'Rejected' },
          { approvalStatus: 'Rejected' }
        ]
      });

      total = await Document.countDocuments(baseQuery);
    } else if (userRole === 'Legal Team') {
      const legalFolders = await Folder.find({
        tenantId,
        isDeleted: false,
        $or: [
          { folderCategory: 'Legal' },
          { name: { $regex: /legal/i } }
        ]
      }).select('_id');
      const legalFolderIds = legalFolders.map(f => f._id);

      const legalScope = {
        $or: [
          { folderId: { $in: legalFolderIds } },
          { 'approvalWorkflow.requiresLegal': true },
          { approvalStatus: 'Pending_Legal_Approval' }
        ]
      };

      pendingAction = await Document.countDocuments({
        ...baseQuery,
        $and: [
          legalScope,
          {
            $or: [
              { 'approvalWorkflow.legalApproval.status': 'Pending' },
              { approvalStatus: { $in: ['Pending_Legal_Approval', 'Pending_Dual_Approval'] } }
            ]
          },
          { approvalStatus: { $nin: ['Approved', 'Rejected'] } }
        ]
      });

      approved = await Document.countDocuments({
        ...baseQuery,
        $and: [
          legalScope,
          {
            $or: [
              { 'approvalWorkflow.legalApproval.status': 'Approved' },
              { approvalStatus: 'Approved' }
            ]
          }
        ]
      });

      rejected = await Document.countDocuments({
        ...baseQuery,
        $and: [
          legalScope,
          {
            $or: [
              { 'approvalWorkflow.legalApproval.status': 'Rejected' },
              { approvalStatus: 'Rejected' }
            ]
          }
        ]
      });

      total = await Document.countDocuments({
        ...baseQuery,
        $and: [legalScope]
      });
    } else if (userRole === 'Compliance Team') {
      const complianceFolders = await Folder.find({
        tenantId,
        isDeleted: false,
        $or: [
          { folderCategory: 'Compliance' },
          { name: { $regex: /compliance/i } }
        ]
      }).select('_id');
      const complianceFolderIds = complianceFolders.map(f => f._id);

      const complianceScope = {
        $or: [
          { folderId: { $in: complianceFolderIds } },
          { 'approvalWorkflow.requiresCompliance': true },
          { approvalStatus: 'Pending_Compliance_Approval' }
        ]
      };

      pendingAction = await Document.countDocuments({
        ...baseQuery,
        $and: [
          complianceScope,
          {
            $or: [
              { 'approvalWorkflow.complianceApproval.status': 'Pending' },
              { approvalStatus: { $in: ['Pending_Compliance_Approval', 'Pending_Dual_Approval'] } }
            ]
          },
          { approvalStatus: { $nin: ['Approved', 'Rejected'] } }
        ]
      });

      approved = await Document.countDocuments({
        ...baseQuery,
        $and: [
          complianceScope,
          {
            $or: [
              { 'approvalWorkflow.complianceApproval.status': 'Approved' },
              { approvalStatus: 'Approved' }
            ]
          }
        ]
      });

      rejected = await Document.countDocuments({
        ...baseQuery,
        $and: [
          complianceScope,
          {
            $or: [
              { 'approvalWorkflow.complianceApproval.status': 'Rejected' },
              { approvalStatus: 'Rejected' }
            ]
          }
        ]
      });

      total = await Document.countDocuments({
        ...baseQuery,
        $and: [complianceScope]
      });
    } else {
      // Manager / Admin
      pendingAction = await Document.countDocuments({
        ...baseQuery,
        approvalStatus: { $in: ['Pending_Reporting_Approval', 'Pending_Legal_Approval', 'Pending_Compliance_Approval', 'Pending_Dual_Approval', 'Pending'] }
      });

      approved = await Document.countDocuments({
        ...baseQuery,
        approvalStatus: 'Approved'
      });

      rejected = await Document.countDocuments({
        ...baseQuery,
        approvalStatus: 'Rejected'
      });

      total = await Document.countDocuments(baseQuery);
    }

    const totalEvaluated = approved + rejected;

    return res.status(200).json({
      success: true,
      data: {
        pendingAction,
        pendingCount: pendingAction,
        myPendingActionCount: pendingAction,
        approved,
        approvedCount: approved,
        rejected,
        rejectedCount: rejected,
        total,
        totalCount: total,
        totalEvaluated
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listPendingApprovals,
  makeApprovalDecision,
  getApprovalStats
};
