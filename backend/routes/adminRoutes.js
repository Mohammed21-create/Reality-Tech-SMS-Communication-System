'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const authController = require('../controllers/authController')('admin');
const schools = require('../controllers/admin/schoolController');
const platform = require('../controllers/admin/platformController');

const router = express.Router();
const loginLimits = [
  rateLimit({ name: 'admin-login-ip', windowSec: 900, max: 20, message: 'Too many sign-in attempts. Try again in a few minutes.' }),
  rateLimit({ name: 'admin-login-email', windowSec: 900, max: 10, key: (req) => String((req.body && req.body.email) || '').toLowerCase().slice(0, 254), message: 'Too many sign-in attempts for this account. Try again later.' }),
];

router.post('/auth/login', loginLimits, authController.login);
const authOnly = requireAuth('admin', { allowPasswordChange: true });
router.post('/auth/logout', authOnly, authController.logout);
router.get('/auth/me', authOnly, authController.me);
router.post('/auth/change-password', authOnly, authController.changePassword);

router.use(requireAuth('admin'));
router.get('/schools', schools.list);
router.post('/schools', schools.create);
router.get('/schools/:id', schools.get);
router.patch('/schools/:id', schools.update);
router.post('/schools/:id/status', schools.setStatus);
router.post('/schools/:id/reset-admin-password', schools.resetAdminPassword);
router.post('/schools/:id/admins', schools.addAdmin);
router.get('/schools/:id/usage', schools.usage);

router.get('/overview', platform.overview);
router.get('/system/health', platform.health);
router.get('/settings', platform.getSettings);
router.put('/settings', platform.updateSettings);
router.get('/logs', platform.logs);

module.exports = router;
