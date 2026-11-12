'use strict';
const env = require('../config/env');
const { Session, User, School } = require('../models');
const { verifyPassword, hashPassword, passwordProblem } = require('../utils/password');
const { randomToken, sha256 } = require('../utils/crypto');
const { E } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { COOKIES, cookieOptions, ROLE_FOR_REALM } = require('../middleware/auth');

const userDto = (u, school) => ({
  id: u._id, name: u.name, email: u.email, role: u.role,
  mustChangePassword: !!u.mustChangePassword,
  school: school ? { id: school._id, name: school.name } : undefined,
});

async function createSession(req, res, user, realm) {
  const token = randomToken(32);
  const absoluteMs = env.session.absoluteHours * 3600 * 1000;
  const session = await Session.create({
    tokenHash: sha256(token), userId: user._id, realm, schoolId: realm === 'school' ? user.schoolId : undefined, csrfToken: randomToken(24),
    ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    expiresAt: new Date(Date.now() + absoluteMs),
  });
  res.cookie(COOKIES[realm], token, cookieOptions(absoluteMs));
  return session;
}

const sessionInfo = (session) => ({ csrfToken: session.csrfToken, idleTimeoutMinutes: env.session.idleMinutes });

async function login(req, res, realm, emailRaw, password) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const GENERIC = 'Incorrect email or password';
  if (!email || typeof password !== 'string' || !password) throw E.badRequest('Email and password are required');

  const user = await User.findOne({ email, role: ROLE_FOR_REALM[realm] }).select('+passwordHash');
  if (user && user.lockUntil && user.lockUntil > new Date()) {
    await audit(req, { action: 'auth.login_blocked_locked', status: 'failure', actor: { role: user.role, _id: user._id, email }, schoolId: user.schoolId });
    throw E.tooMany('Too many failed attempts. This account is temporarily locked. Try again later.');
  }
  const ok = await verifyPassword(password, user && user.passwordHash); // constant-ish time even for unknown users
  if (!user || !ok) {
    if (user) {
      const failures = (user.failedLoginCount || 0) + 1;
      const update = { failedLoginCount: failures };
      if (failures >= env.login.maxFailures) { update.lockUntil = new Date(Date.now() + env.login.lockMinutes * 60000); update.failedLoginCount = 0; }
      await User.updateOne({ _id: user._id }, { $set: update });
    }
    await audit(req, { action: 'auth.login_failed', status: 'failure', actor: { role: realm === 'admin' ? 'super_admin' : 'school_admin', email }, schoolId: user && user.schoolId });
    throw E.unauthorized(GENERIC, 'BAD_CREDENTIALS');
  }
  if (user.status !== 'active') throw E.forbidden('This account has been disabled. Contact Reality Tech.', 'ACCOUNT_DISABLED');

  let school = null;
  if (realm === 'school') {
    school = await School.findById(user.schoolId);
    if (!school || school.status !== 'active') {
      await audit(req, { action: 'auth.login_blocked_school_inactive', status: 'failure', actor: user, schoolId: user.schoolId });
      throw E.forbidden('This school account is not active. Please contact Reality Tech.', 'SCHOOL_NOT_ACTIVE');
    }
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lastLoginAt: new Date(), lastLoginIp: req.ip }, $unset: { lockUntil: 1 } });
  const session = await createSession(req, res, user, realm);
  await audit(req, { action: 'auth.login', actor: user, schoolId: user.schoolId });
  return { user: userDto(user, school), ...sessionInfo(session) };
}

async function logout(req, res, realm) {
  if (req.session) await Session.deleteOne({ _id: req.session._id });
  res.clearCookie(COOKIES[realm], cookieOptions());
  await audit(req, { action: 'auth.logout' });
}

async function changePassword(req, res, realm, current, next) {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await verifyPassword(String(current || ''), user.passwordHash))) {
    await audit(req, { action: 'auth.change_password_failed', status: 'failure' });
    throw E.badRequest('Current password is incorrect', undefined, 'BAD_CURRENT_PASSWORD');
  }
  const problem = passwordProblem(next, { email: user.email, name: user.name });
  if (problem) throw E.badRequest(problem, undefined, 'WEAK_PASSWORD');
  if (await verifyPassword(next, user.passwordHash)) throw E.badRequest('New password must be different from the current one');
  user.passwordHash = await hashPassword(next);
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  await user.save();
  // Invalidate all other sessions, then issue a fresh one (session fixation protection).
  await Session.deleteMany({ userId: user._id });
  const session = await createSession(req, res, user, realm);
  req.user = user;
  await audit(req, { action: 'auth.change_password' });
  return { user: userDto(user, req.school), ...sessionInfo(session) };
}

function me(req) {
  return { user: userDto(req.user, req.school), ...sessionInfo(req.session) };
}

module.exports = { login, logout, changePassword, me, userDto };
