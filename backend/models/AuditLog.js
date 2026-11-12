'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  actorType: { type: String, enum: ['super_admin', 'school_admin', 'system', 'anonymous'], required: true },
  actorId: mongoose.Schema.Types.ObjectId,
  actorEmail: String,
  schoolId: { type: mongoose.Schema.Types.ObjectId, index: true },
  action: { type: String, required: true, index: true },
  targetType: String,
  targetId: String,
  status: { type: String, enum: ['success', 'failure'], default: 'success' },
  ip: String,
  userAgent: { type: String, maxlength: 300 },
  meta: mongoose.Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

schema.index({ createdAt: -1 });
schema.index({ schoolId: 1, createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', schema);
