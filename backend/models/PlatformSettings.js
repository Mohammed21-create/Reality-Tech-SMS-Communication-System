'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: { type: String, maxlength: 300, default: '' },
  perSchoolMaxInflight: { type: Number, min: 1, max: 20, default: 2 },
  maxRecipientsPerMessage: { type: Number, min: 1, max: 1000000, default: 200000 },
  defaultTrialDays: { type: Number, min: 1, max: 365, default: 30 },
  enabledProviders: { type: [String], default: [] }, // empty = all registered providers
}, { timestamps: true });

schema.statics.get = async function () {
  return this.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('PlatformSettings', schema);
