require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { errorHandler } = require('./shared/error.handler');
const { authenticate, authorizeRoles } = require('./shared/auth.middleware');
const { tenantResolver } = require('./shared/middleware/tenant.resolver');

const app = express();
app.use(cors());
app.use(express.json());

const router = express.Router({ mergeParams: true });

router.use(tenantResolver);
router.use(authenticate);

// Get profile of current user
router.get('/profile', async (req, res, next) => {
  try {
    const user = await req.User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, data: user });
  } catch (err) { next(err); }
});

// Update profile of current user
router.put('/profile', async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const user = await req.User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name) user.name = name;
    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const existingUser = await req.User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
      user.email = email;
    }

    await user.save();
    res.status(200).json({ success: true, message: 'Profile updated successfully', data: user });
  } catch (err) { next(err); }
});

// Get Users
router.get('/', authorizeRoles('Tenant Admin', 'Manager'), async (req, res, next) => {
  try {
    const users = await req.User.find().populate('departmentId', 'name').select('-password');
    res.status(200).json({ success: true, data: users });
  } catch (err) { next(err); }
});

// Create User
router.post('/', authorizeRoles('Tenant Admin', 'Manager'), async (req, res, next) => {
  try {
    const { name, email, role, password, departmentId } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!['Manager', 'Viewer'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
    
    // Managers can only create Viewers
    if (req.user.role === 'Manager' && role !== 'Viewer') {
      return res.status(403).json({ success: false, message: 'Forbidden: Managers can only create Viewers' });
    }
    
    const tempPassword = password || crypto.randomBytes(8).toString('hex');
    const user = new req.User({ name, email, role, password: tempPassword, departmentId: departmentId || null });
    await user.save();

    // Direct REST API Call to Email Service
    fetch(process.env.EMAIL_SERVICE_URL + '/api/email/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        role,
        companyName: req.tenant.companyName,
        companySlug: req.tenant.companySlug,
        tempPassword,
        loginUrl: `${process.env.FRONTEND_URL}/${req.tenant.companySlug}/login`
      })
    }).catch(err => console.error('Failed to call email service:', err.message));

    res.status(201).json({ success: true, message: 'User created' });
  } catch (err) { next(err); }
});

// Update User
router.put('/:id', authorizeRoles('Tenant Admin', 'Manager'), async (req, res, next) => {
  try {
    const { name, email, role, status } = req.body;
    const userToUpdate = await req.User.findById(req.params.id);
    if (!userToUpdate) return res.status(404).json({ success: false, message: 'User not found' });

    // Managers can only update Viewers
    if (req.user.role === 'Manager') {
      if (userToUpdate.role !== 'Viewer') {
        return res.status(403).json({ success: false, message: 'Forbidden: Managers can only update Viewers' });
      }
      if (role && role !== 'Viewer') {
        return res.status(403).json({ success: false, message: 'Forbidden: Managers can only assign Viewer role' });
      }
    }

    if (name) userToUpdate.name = name;
    if (email) userToUpdate.email = email;
    if (role) userToUpdate.role = role;
    if (status) userToUpdate.status = status;
    if (req.body.departmentId !== undefined) {
      userToUpdate.departmentId = req.body.departmentId || null;
    }

    await userToUpdate.save();
    res.status(200).json({ success: true, message: 'User updated successfully', user: userToUpdate });
  } catch (err) { next(err); }
});

// Delete User
router.delete('/:id', authorizeRoles('Tenant Admin', 'Manager'), async (req, res, next) => {
  try {
    const userToDelete = await req.User.findById(req.params.id);
    if (!userToDelete) return res.status(404).json({ success: false, message: 'User not found' });

    // Managers can only delete Viewers
    if (req.user.role === 'Manager' && userToDelete.role !== 'Viewer') {
      return res.status(403).json({ success: false, message: 'Forbidden: Managers can only delete Viewers' });
    }

    await req.User.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (err) { next(err); }
});

app.use('/api/:companySlug/users', router);

const departmentRoutes = require('./routes/department.routes');
app.use('/api/:companySlug/departments', departmentRoutes);

const brandingRoutes = require('./routes/branding.routes');
app.use('/api/:companySlug/branding', brandingRoutes);

app.use(errorHandler);

mongoose.connect(process.env.MONGO_MASTER_URI)
  .then(() => {
    console.log('User Service connected to Master DB');
    const PORT = process.env.PORT || 3004;
    app.listen(PORT, () => console.log('User Service running on port ' + PORT));
  })
  .catch(err => console.error(err));