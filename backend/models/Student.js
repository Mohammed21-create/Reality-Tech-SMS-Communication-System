'use strict';
const mongoose = require('mongoose');
const tenantGuard = require('../plugins/tenantGuard');

const schema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  fullNameLower: { type: String, required: true },
  className: { type: String, trim: true, maxlength: 60, default: '' },
  studentNumber: { type: String, trim: true, maxlength: 40, default: '' },
  parentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Parent' }],
}, { timestamps: true });

schema.plugin(tenantGuard);
schema.index({ schoolId: 1, fullNameLower: 1 });
schema.index({ schoolId: 1, parentIds: 1 });
schema.pre('validate', function (next) {
  if (this.fullName) this.fullNameLower = this.fullName.toLowerCase();
  next();
});

module.exports = mongoose.model('Student', schema);
