'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  provider: String,
  providerMessageId: String,
  status: { type: String, enum: ['delivered', 'failed'], required: true },
  providerStatus: { type: String, maxlength: 80 },
  reason: { type: String, maxlength: 300 },
  source: { type: String, enum: ['webhook', 'poll'], required: true },
  receivedAt: { type: Date, default: Date.now },
}, { versionKey: false });

schema.plugin(tenantGuard);
schema.index({ schoolId: 1, messageId: 1, receivedAt: -1 });
schema.index({ receivedAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

module.exports = mongoose.model('SmsDeliveryReport', schema);
