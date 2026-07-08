const mongoose = require('mongoose');

const createDepartment = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const tenantId = req.user.companySlug;
    const createdBy = req.user.userId; // Fixed: req.user.userId instead of req.user.id

    if (!name) {
      return res.status(400).json({ success: false, message: 'Department name is required' });
    }

    const existingDept = await req.Department.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') }, tenantId });
    if (existingDept) {
      return res.status(400).json({ success: false, message: 'Department with this name already exists' });
    }

    const newDepartment = await req.Department.create({
      name,
      description,
      tenantId,
      createdBy,
    });

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: newDepartment,
    });
  } catch (error) {
    next(error);
  }
};

const getDepartments = async (req, res, next) => {
  try {
    const tenantId = req.user.companySlug;
    const departments = await req.Department.find({ tenantId }).sort({ name: 1 }).populate('createdBy', 'name email');

    res.status(200).json({
      success: true,
      data: departments,
    });
  } catch (error) {
    next(error);
  }
};

const updateDepartment = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const { id } = req.params;
    const tenantId = req.user.companySlug;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Department name is required' });
    }

    const existingDept = await req.Department.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') }, tenantId, _id: { $ne: id } });
    if (existingDept) {
      return res.status(400).json({ success: false, message: 'Another department with this name already exists' });
    }

    const department = await req.Department.findOneAndUpdate(
      { _id: id, tenantId },
      { name, description },
      { new: true, runValidators: true }
    );

    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Department updated successfully',
      data: department,
    });
  } catch (error) {
    next(error);
  }
};

const deleteDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.companySlug;

    // Check if any users are assigned to this department
    const usersInDept = await req.User.countDocuments({ departmentId: id });
    if (usersInDept > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete department. ${usersInDept} user(s) are currently assigned to it.` 
      });
    }

    const department = await req.Department.findOneAndDelete({ _id: id, tenantId });

    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDepartment,
  getDepartments,
  updateDepartment,
  deleteDepartment,
};
