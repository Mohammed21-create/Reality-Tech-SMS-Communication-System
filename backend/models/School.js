'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 150 },
  nameLower: { type: String, required: true, unique: true, select: false },
  status: { type: String, enum: ['pending', 'active', 'suspended', 'deactivated'], default: 'pending', index: true },
  statusReason: { type: String, maxlength: 300, default: '' },
  statusChangedAt: Date,
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  contactPhone: { type: String, trim: true, maxlength: 30, default: '' },
  address: { type: String, trim: true, maxlength: 300, default: '' },
  region: { type: String, trim: true, maxlength: 80, default: '' },
  subscription: {
    plan: { type: String, enum: ['trial', 'standard', 'premium'], default: 'trial' },
    status: { type: String, enum: ['trial', 'active', 'past_due', 'expired', 'cancelled'], default: 'trial' },
    startsAt: { type: Date, default: Date.now },
    expiresAt: Date,
  },
  notes: { type: String, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ createdAt: -1 });
schema.pre('validate', function (next) {
  if (this.name) this.nameLower = this.name.toLowerCase().replace(/\s+/g, ' ');
  next();
});

module.exports = mongoose.model('School', schema);
