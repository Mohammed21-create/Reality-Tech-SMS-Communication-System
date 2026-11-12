'use strict';
const mongoose = require('mongoose');

/**
 * Database-layer tenant isolation. Every query/aggregation on a tenant-owned model MUST
 * filter on `schoolId`, otherwise it throws. Platform jobs that legitimately span tenants
 * (scheduler, delivery-report poller, reaper) opt out explicitly with
 * `.setOptions({ skipTenantGuard: true })` or `Model.aggregate(p).option({ skipTenantGuard: true })`.
 */
function validTenantValue(v) {
  if (v === undefined || v === null) return false;
  if (v instanceof mongoose.Types.ObjectId) return true;
  if (typeof v === 'string') return /^[a-f\d]{24}$/i.test(v);
  return false; // objects such as { $ne: ... } / { $exists: ... } are rejected
}

module.exports = function tenantGuard(schema) {
  const queryOps = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
    'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'countDocuments', 'distinct'];
  const check = function () {
    const opts = typeof this.getOptions === 'function' ? this.getOptions() : this.options;
    if (opts && opts.skipTenantGuard) return;
    const filter = typeof this.getFilter === 'function' ? this.getFilter() : this._conditions;
    if (!filter || !validTenantValue(filter.schoolId)) {
      throw new Error(`Tenant guard: ${this.op} on ${this.model.modelName} requires a plain schoolId filter`);
    }
  };
  queryOps.forEach((op) => schema.pre(op, check));

  schema.pre('aggregate', function () {
    if (this.options && this.options.skipTenantGuard) return;
    const first = this.pipeline()[0];
    if (!first || !first.$match || !validTenantValue(first.$match.schoolId)) {
      throw new Error(`Tenant guard: aggregate on ${this.model().modelName} must start with $match on schoolId`);
    }
  });
};
