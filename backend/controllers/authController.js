'use strict';
const auth = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

/** Builds login/logout/me/change-password handlers for a realm ('admin' | 'school'). */
module.exports = (realm) => ({
  login: asyncHandler(async (req, res) => res.json(await auth.login(req, res, realm, req.body && req.body.email, req.body && req.body.password))),
  logout: asyncHandler(async (req, res) => { await auth.logout(req, res, realm); res.json({ ok: true }); }),
  me: asyncHandler(async (req, res) => res.json(auth.me(req))),
  changePassword: asyncHandler(async (req, res) => res.json(await auth.changePassword(req, res, realm, req.body && req.body.currentPassword, req.body && req.body.newPassword))),
});
