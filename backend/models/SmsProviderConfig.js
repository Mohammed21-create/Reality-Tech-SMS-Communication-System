'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
  provider: { type: String, required: true, maxlength: 40 },
  encryptedCredentials: { type: String, required: true, select: false }, // AES-256-GCM, AAD = schoolId
  credentialHints: { type: Map, of: String, default: {} }, // e.g. { apiKey: '••••ab12' } - never the secret
  costPerSegment: { type: Number, min: 0, default: 0 },
  currency: { type: String, maxlength: 5, default: 'GHS' },
  isActive: { type: Boolean, default: true },
  webhookTokenHash: { type: String, index: true, select: false },
  webhookTokenEnc: { type: String, select: false }, // encrypted so the webhook URL can be shown again
  lastTestAt: Date,
  lastTestOk: Boolean,
  lastTestMessage: { type: String, maxlength: 300 },
  lastBalance: { amount: Number, unit: String, checkedAt: Date },
}, { timestamps: true });

schema.plugin(tenantGuard);
module.exports = mongoose.model('SmsProviderConfig', schema);
