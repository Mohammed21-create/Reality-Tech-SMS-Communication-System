'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  fullNameLower: { type: String, required: true },
  phones: {
    type: [new mongoose.Schema({
      number: { type: String, required: true, match: /^\+\d{8,15}$/ }, // E.164
      label: { type: String, maxlength: 20, default: 'mobile' },
    }, { _id: false })],
    validate: [(v) => v.length >= 1 && v.length <= 3, 'A parent needs 1 to 3 phone numbers'],
  },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  notes: { type: String, maxlength: 500, default: '' },
}, { timestamps: true });

schema.plugin(tenantGuard);
schema.index({ schoolId: 1, fullNameLower: 1 });
schema.index({ schoolId: 1, 'phones.number': 1 });
schema.index({ schoolId: 1, status: 1 });
schema.pre('validate', function (next) {
  if (this.fullName) this.fullNameLower = this.fullName.toLowerCase();
  next();
});

module.exports = mongoose.model('Parent', schema);
