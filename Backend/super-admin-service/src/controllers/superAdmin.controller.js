const SuperAdmin = require('../models/superAdmin.model');
const { generateTokens } = require('../shared/jwt.utils');

const register = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const existing = await SuperAdmin.findOne();
    if (existing) return res.status(400).json({ success: false, message: 'Super Admin already exists' });

    const superAdmin = new SuperAdmin({ email, password });
    await superAdmin.save();
    res.status(201).json({ success: true, message: 'Super Admin registered' });
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const superAdmin = await SuperAdmin.findOne({ email });
    if (!superAdmin || !(await superAdmin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    superAdmin.role = 'SuperAdmin';
    const tokens = generateTokens(superAdmin);
    res.status(200).json({ success: true, tokens });
  } catch (err) { next(err); }
};

const Enquiry = require('../shared/models/enquiry.model');

const createEnquiry = async (req, res, next) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const enquiry = new Enquiry({ name, email, subject, message });
    await enquiry.save();
    res.status(201).json({ success: true, message: 'Enquiry submitted successfully' });
  } catch (err) { next(err); }
};

const getEnquiries = async (req, res, next) => {
  try {
    const enquiries = await Enquiry.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, enquiries });
  } catch (err) { next(err); }
};

const { getTenantConnection } = require('../shared/tenant.db');

const getDashboardStats = async (req, res, next) => {
  try {
    const Tenant = require('../shared/models/tenant.model');
    const allTenants = await Tenant.find().sort({ createdAt: -1 });
    
    let totalDocuments = 0;
    let totalFolders = 0;
    let totalUsers = 0;

    let allRecentDocuments = [];
    const documentsByMonth = {
      'Jan': 0, 'Feb': 0, 'Mar': 0, 'Apr': 0, 'May': 0, 'Jun': 0,
      'Jul': 0, 'Aug': 0, 'Sep': 0, 'Oct': 0, 'Nov': 0, 'Dec': 0
    };
    const documentTypesCount = {
      pdf: { name: 'PDF', value: 0, color: '#4f6df5' },
      doc: { name: 'Word', value: 0, color: '#9aa8c1' },
      xls: { name: 'Excel', value: 0, color: '#34c7a1' },
      img: { name: 'Image', value: 0, color: '#f6b51d' },
      other: { name: 'Other', value: 0, color: '#c8d0de' }
    };
    
    const topCompaniesData = [];

    // Concurrently aggregate from all tenant DBs
    await Promise.all(allTenants.map(async (tenant) => {
      try {
        if (!tenant.dbUri) return;
        const tenantDb = await getTenantConnection(tenant.companySlug, tenant.dbUri);
        
        if (tenantDb.readyState !== 1) {
          await tenantDb.asPromise();
        }

        const docCount = await tenantDb.db.collection('documents').countDocuments();
        const folderCount = await tenantDb.db.collection('folders').countDocuments();
        const userCount = await tenantDb.db.collection('users').countDocuments();
        
        totalDocuments += docCount;
        totalFolders += folderCount;
        totalUsers += userCount;

        topCompaniesData.push({ name: tenant.companyName, value: docCount });

        // Month Aggregation for Documents Over Time
        const monthAggregation = await tenantDb.db.collection('documents').aggregate([
          { $group: { _id: { $month: "$createdAt" }, count: { $sum: 1 } } }
        ]).toArray();

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        monthAggregation.forEach(m => {
          if (m._id && m._id >= 1 && m._id <= 12) {
            const monthName = monthNames[m._id - 1];
            documentsByMonth[monthName] += m.count;
          }
        });

        const typeAggregation = await tenantDb.db.collection('documents').aggregate([
          { $group: { _id: "$fileType", count: { $sum: 1 } } }
        ]).toArray();

        typeAggregation.forEach(t => {
          const ext = (t._id || '').toLowerCase();
          if (ext.includes('pdf')) documentTypesCount.pdf.value += t.count;
          else if (ext.includes('doc') || ext.includes('word')) documentTypesCount.doc.value += t.count;
          else if (ext.includes('xls') || ext.includes('sheet') || ext.includes('csv')) documentTypesCount.xls.value += t.count;
          else if (ext.includes('png') || ext.includes('jpg') || ext.includes('jpeg') || ext.includes('image')) documentTypesCount.img.value += t.count;
          else documentTypesCount.other.value += t.count;
        });

        const recentDocs = await tenantDb.db.collection('documents')
          .find({})
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        recentDocs.forEach(doc => {
          let type = 'other';
          const ext = (doc.fileType || '').toLowerCase();
          if (ext.includes('pdf')) type = 'pdf';
          else if (ext.includes('doc')) type = 'doc';
          else if (ext.includes('xls')) type = 'xls';

          allRecentDocuments.push([
            doc.originalFileName || doc.name || 'Untitled',
            tenant.companyName,
            new Date(doc.createdAt || Date.now()).toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' }),
            type,
            new Date(doc.createdAt || 0).getTime()
          ]);
        });
      } catch (err) {
        console.error(`Failed to aggregate stats for ${tenant.companySlug}:`, err.message);
      }
    }));

    const totalCompanies = allTenants.length;
    const activeCompanies = allTenants.filter(t => t.isActive !== false).length; 

    const companiesList = allTenants.map(t => [
      t.companyName,
      t.isActive !== false ? "Active" : "Inactive",
      new Date(t.createdAt || Date.now()).toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' })
    ]);

    // Generate recent activity from latest tenants
    const recentActivity = allTenants.slice(0, 5).map(t => ({
      color: "bg-blue-500",
      title: `New company "${t.companyName}" has been registered.`,
      meta: `Super Admin - ${new Date(t.createdAt || Date.now()).toLocaleString("en-US", { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    }));

    const totalDocsForTypes = Math.max(1, totalDocuments);
    const documentTypes = Object.values(documentTypesCount).map(dt => ({
      name: dt.name,
      value: parseFloat(((dt.value / totalDocsForTypes) * 100).toFixed(1)),
      count: dt.value.toLocaleString(),
      color: dt.color
    })).filter(dt => dt.value > 0);

    if (documentTypes.length === 0) {
      documentTypes.push({ name: 'None', value: 100, count: '0', color: '#e2e8f0' });
    }

    allRecentDocuments.sort((a, b) => b[4] - a[4]);
    const topRecentDocuments = allRecentDocuments.slice(0, 5).map(arr => [arr[0], arr[1], arr[2], arr[3]]);

    topCompaniesData.sort((a, b) => b.value - a.value);
    const topCompanies = topCompaniesData.slice(0, 5);

    const documentsOverTime = [
      { month: "Jan", documents: documentsByMonth["Jan"] },
      { month: "Feb", documents: documentsByMonth["Feb"] },
      { month: "Mar", documents: documentsByMonth["Mar"] },
      { month: "Apr", documents: documentsByMonth["Apr"] },
      { month: "May", documents: documentsByMonth["May"] },
      { month: "Jun", documents: documentsByMonth["Jun"] },
      { month: "Jul", documents: documentsByMonth["Jul"] },
      { month: "Aug", documents: documentsByMonth["Aug"] },
      { month: "Sep", documents: documentsByMonth["Sep"] },
      { month: "Oct", documents: documentsByMonth["Oct"] },
      { month: "Nov", documents: documentsByMonth["Nov"] },
      { month: "Dec", documents: documentsByMonth["Dec"] },
    ].filter(d => d.documents > 0 || ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].includes(d.month)); // Keep at least Jan-Jun for visual structure

    res.status(200).json({
      success: true,
      stats: {
        totalCompanies,
        activeCompanies,
        totalDocuments,
        totalFolders,
        totalFiles: totalDocuments,
        totalUsers,
      },
      companiesList: companiesList.slice(0, 5),
      documentTypes,
      recentDocuments: topRecentDocuments,
      topCompanies,
      documentsOverTime,
      recentActivity
    });
  } catch (err) { next(err); }
};

const replyEnquiry = async (req, res, next) => {
  try {
    const { email, subject, message, replyFrom } = req.body;
    
    // Call internal email-service
    const emailRes = await fetch(process.env.EMAIL_SERVICE_URL + '/api/email/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, subject, message, replyFrom }),
    });

    const data = await emailRes.json();
    if (data.success) {
      res.status(200).json({ success: true, message: 'Reply sent successfully' });
    } else {
      res.status(400).json({ success: false, message: data.message || 'Failed to send reply' });
    }
  } catch (err) {
    console.error('Failed to forward reply to email-service:', err);
    next(err);
  }
};

module.exports = { register, login, createEnquiry, getEnquiries, getDashboardStats, replyEnquiry };