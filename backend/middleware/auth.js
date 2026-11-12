'use strict';
const env = require('../config/env');
const { Session, User, School } = require('../models');
const { sha256, safeEqual } = require('../utils/crypto');
const { E } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const COOKIES = { admin: 'rt_admin_sid', school: 'rt_school_sid' };
const ROLE_FOR_REALM = { admin: 'super_admin', school: 'school_admin' };
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const cookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: env.session.cookieSecure,
  sameSite: 'strict',
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});
const clearSessionCookie = (res, realm) => res.clearCookie(COOKIES[realm], cookieOptions());

/**
 * Authenticates a request for one realm ("admin" = Reality Tech, "school" = school admin).
 * Tenant identity (`req.tenantId`) is derived ONLY from the server-side session/user record,
 * never from request parameters.
 * @param {'admin'|'school'} realm
 * @param {{allowPasswordChange?: boolean}} opts  true for endpoints usable while a password change is pending
 */
function requireAuth(realm, { allowPasswordChange = false } = {}) {
  return asyncHandler(async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIES[realm]];
    if (!token) throw E.unauthorized();
    const session = await Session.findOne({ tokenHash: sha256(token), realm });
    if (!session) { clearSessionCookie(res, realm); throw E.unauthorized(); }

    const now = Date.now();
    const idleMs = env.session.idleMinutes * 60 * 1000;
    if (session.expiresAt.getTime() <= now || now - session.lastActivityAt.getTime() > idleMs) {
      await Session.deleteOne({ _id: session._id });
      clearSessionCookie(res, realm);
      throw E.unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
    }

    // User and school are fetched in parallel to keep per-request latency low (matters with a remote database).
    const [user, schoolEarly] = await Promise.all([
      User.findById(session.userId),
      realm === 'school' && session.schoolId ? School.findById(session.schoolId) : null,
    ]);
    if (!user || user.status !== 'active' || user.role !== ROLE_FOR_REALM[realm]) {
      await Session.deleteOne({ _id: session._id });
      clearSessionCookie(res, realm);
      throw E.unauthorized();
    }

    if (realm === 'school') {
      const school = schoolEarly && String(schoolEarly._id) === String(user.schoolId) ? schoolEarly : await School.findById(user.schoolId);
      if (!school) throw E.unauthorized();
      if (school.status !== 'active') {
        throw E.forbidden('This school account is not active. Please contact Reality Tech.', 'SCHOOL_NOT_ACTIVE');
      }
      req.school = school;
      req.tenantId = school._id; // authoritative tenant id (ObjectId from the database)
    }

    if (UNSAFE.has(req.method)) {
      const header = req.get('x-csrf-token');
      if (!header || !safeEqual(header, session.csrfToken)) throw E.forbidden('Security token missing or invalid. Refresh the page.', 'CSRF_FAILED');
    }

    if (user.mustChangePassword && !allowPasswordChange) {
      throw E.forbidden('You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    }

    if (now - session.lastActivityAt.getTime() > 60 * 1000) {
      Session.updateOne({ _id: session._id }, { $set: { lastActivityAt: new Date(now) } }).catch(() => {});
    }
    req.user = user;
    req.session = session;
    next();
  });
}

module.exports = { requireAuth, COOKIES, cookieOptions, clearSessionCookie, ROLE_FOR_REALM };
