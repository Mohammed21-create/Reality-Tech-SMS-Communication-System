'use strict';
const AuditLog = require('../models/AuditLog');
const logger = require('./logger');
const { clean } = require('./sanitize');

/**
 * Fire-and-forget audit trail entry. Never throws. `meta` is redacted before storage.
 * actor defaults to req.user (set by auth middleware).
 */
function audit(req, { action, status = 'success', schoolId, targetType, targetId, meta, actor } = {}) {
  const u = actor || (req && req.user) || null;
  const doc = {
    actorType: u ? u.role : 'anonymous',
    actorId: u ? u._id || u.id : undefined,
    actorEmail: u ? u.email : undefined,
    schoolId: schoolId || (u && u.schoolId) || undefined,
    action,
    status,
    targetType,
    targetId: targetId ? String(targetId) : undefined,
    ip: req ? req.ip : undefined,
    userAgent: req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 300) : undefined,
    meta: meta ? clean(logger.redact(meta)) : undefined,
  };
  return AuditLog.create(doc).catch((e) => logger.error('audit_write_failed', { message: e.message, action }));
}

const systemAudit = (opts) => audit(null, { ...opts, actor: { role: 'system' } });

module.exports = { audit, systemAudit };
