'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  role: { type: String, enum: ['super_admin', 'school_admin'], required: true, index: true },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true,
    validate: { validator() { return this.role !== 'school_admin' || !!this.schoolId; }, message: 'School admins must belong to a school' },
  },
  passwordHash: { type: String, required: true, select: false },
  mustChangePassword: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  failedLoginCount: { type: Number, default: 0 },
  lockUntil: Date,
  lastLoginAt: Date,
  lastLoginIp: String,
  passwordChangedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('User', schema);
