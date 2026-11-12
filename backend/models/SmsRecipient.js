'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const STATUSES = ['queued', 'sending', 'accepted', 'delivered', 'failed', 'uncertain', 'cancelled'];

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmsMessage', required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId },
  parentName: { type: String, maxlength: 120 },
  phone: { type: String, required: true }, // E.164
  batchNo: { type: Number, required: true },
  status: { type: String, enum: STATUSES, default: 'queued' },
  attempts: { type: Number, default: 0 },
  claimToken: String,
  providerMessageId: String,
  lastError: { type: String, maxlength: 300 },
  retryable: { type: Boolean, default: false },
  acceptedAt: Date,
  deliveredAt: Date,
  failedAt: Date,
  lastStatusCheckAt: Date,
}, { timestamps: true });

schema.plugin(tenantGuard);
// One SMS per number per message: also makes recipient creation idempotent.
schema.index({ messageId: 1, phone: 1 }, { unique: true });
schema.index({ schoolId: 1, messageId: 1, status: 1 });
schema.index({ schoolId: 1, messageId: 1, batchNo: 1, status: 1 });
schema.index({ schoolId: 1, providerMessageId: 1 }, { sparse: true });
schema.index({ status: 1, acceptedAt: 1 }); // DLR poller
schema.index({ status: 1, updatedAt: 1 }); // stale-claim reaper

const Model = mongoose.model('SmsRecipient', schema);
Model.STATUSES = STATUSES;
module.exports = Model;
