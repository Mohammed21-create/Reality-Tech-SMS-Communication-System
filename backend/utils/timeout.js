'use strict';
/** Reject if `promise` does not settle within `ms` (so a dead dependency can never hang a request). */
function withTimeout(promise, ms, label = 'operation') {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
module.exports = { withTimeout };
