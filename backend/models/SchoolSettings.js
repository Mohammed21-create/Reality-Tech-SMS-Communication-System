'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
  displayName: { type: String, trim: true, maxlength: 150, default: '' },
  contactPhone: { type: String, trim: true, maxlength: 30, default: '' },
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  address: { type: String, trim: true, maxlength: 300, default: '' },
  website: { type: String, trim: true, maxlength: 200, default: '' },
  preferredSenderId: { type: String, trim: true, maxlength: 11, default: '' },
  signature: { type: String, trim: true, maxlength: 160, default: '' },
  appendSignatureByDefault: { type: Boolean, default: true },
  timezone: { type: String, default: 'Africa/Accra' },
  logo: {
    data: { type: Buffer, select: false },
    contentType: String,
    size: Number,
    updatedAt: Date,
  },
}, { timestamps: true });

schema.plugin(tenantGuard);
module.exports = mongoose.model('SchoolSettings', schema);
