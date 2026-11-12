'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const counts = () => ({ type: Number, default: 0 });

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String, maxlength: 120 },
  body: { type: String, required: true, maxlength: 1600 },
  finalText: { type: String, required: true, maxlength: 1800 },
  includeSignature: { type: Boolean, default: true },
  encoding: { type: String, enum: ['GSM-7', 'UCS-2'], required: true },
  segmentsPerMessage: { type: Number, required: true, min: 1 },
  audience: {
    kind: { type: String, enum: ['all', 'selected'], required: true }, // not named "type": Mongoose treats that key specially
    parentIds: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  senderId: { type: String, required: true },
  provider: { type: String, required: true },
  costPerSegment: { type: Number, default: 0 },
  currency: { type: String, default: 'GHS' },
  estimatedRecipients: { type: Number, default: 0 },
  status: {
    type: String, required: true, index: true,
    enum: ['scheduled', 'preparing', 'sending', 'completed', 'cancelled', 'failed'],
  },
  scheduledAt: Date,
  startedAt: Date,
  preparedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  batchCount: { type: Number, default: 0 },
  retryCount: { type: Number, default: 0 },
  idempotencyKey: { type: String, maxlength: 80 },
  lastError: { type: String, maxlength: 300 },
  // Counters by recipient status. `acceptedTotal` = ever accepted by the provider
  // (accepted + delivered + failed-after-acceptance); `delivered` = provider-confirmed.
  counts: {
    total: counts(), queued: counts(), sending: counts(), accepted: counts(), delivered: counts(),
    failed: counts(), uncertain: counts(), cancelled: counts(), acceptedTotal: counts(),
  },
}, { timestamps: true });

schema.plugin(tenantGuard);
schema.index({ schoolId: 1, createdAt: -1 });
schema.index({ schoolId: 1, status: 1, createdAt: -1 });
schema.index({ schoolId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
schema.index({ status: 1, scheduledAt: 1 }); // scheduler scan

module.exports = mongoose.model('SmsMessage', schema);
