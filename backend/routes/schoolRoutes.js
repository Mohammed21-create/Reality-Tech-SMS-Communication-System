'use strict';
const express = require('express');
const multer = require('multer');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const authController = require('../controllers/authController')('school');
const parents = require('../controllers/school/parentController');
const students = require('../controllers/school/studentController');
const messages = require('../controllers/school/messageController');
const reports = require('../controllers/school/reportController');
const settings = require('../controllers/school/settingsController');

const router = express.Router();
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.imports.maxMb * 1024 * 1024, files: 1 } });
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024, files: 1 } });
const tenantKey = (req) => String(req.tenantId);

const loginLimits = [
  rateLimit({ name: 'school-login-ip', windowSec: 900, max: 30, message: 'Too many sign-in attempts. Try again in a few minutes.' }),
  rateLimit({ name: 'school-login-email', windowSec: 900, max: 10, key: (req) => String((req.body && req.body.email) || '').toLowerCase().slice(0, 254), message: 'Too many sign-in attempts for this account. Try again later.' }),
];
router.post('/auth/login', loginLimits, authController.login);
const authOnly = requireAuth('school', { allowPasswordChange: true });
router.post('/auth/logout', authOnly, authController.logout);
router.get('/auth/me', authOnly, authController.me);
router.post('/auth/change-password', authOnly, authController.changePassword);

// Everything below requires a valid school-admin session; tenant id comes from the session only.
router.use(requireAuth('school'));

router.get('/dashboard', reports.dashboard);

router.get('/parents', parents.list);
router.post('/parents', parents.create);
router.get('/parents/export', parents.exportAll);
router.get('/parents/template', parents.template);
router.get('/parents/duplicates', parents.duplicates);
router.post('/parents/import', rateLimit({ name: 'import', windowSec: 3600, max: 10, key: tenantKey, message: 'Import limit reached. Try again later.' }), importUpload.single('file'), parents.importFile);
router.post('/parents/bulk-delete', parents.bulkRemove);
router.get('/parents/:id', parents.get);
router.put('/parents/:id', parents.update);
router.delete('/parents/:id', parents.remove);

router.get('/students', students.list);
router.post('/students', students.create);
router.put('/students/:id', students.update);
router.delete('/students/:id', students.remove);

router.post('/messages/preview', rateLimit({ name: 'preview', windowSec: 60, max: 120, key: tenantKey }), messages.preview);
router.post('/messages', rateLimit({ name: 'send', windowSec: 60, max: 30, key: tenantKey, message: 'You are sending too fast. Please wait a moment.' }), messages.create);
router.get('/messages', messages.list);
router.get('/messages/:id', messages.get);
router.get('/messages/:id/recipients', messages.recipients);
router.get('/messages/:id/recipients.csv', messages.exportRecipients);
router.post('/messages/:id/cancel', messages.cancel);
router.post('/messages/:id/retry', rateLimit({ name: 'retry', windowSec: 60, max: 10, key: tenantKey }), messages.retry);

router.get('/reports/summary', reports.summary);
router.get('/reports/export', reports.exportReport);

router.get('/settings', settings.get);
router.put('/settings', settings.update);
router.post('/settings/logo', logoUpload.single('logo'), settings.uploadLogo);
router.get('/settings/logo', settings.getLogo);
router.delete('/settings/logo', settings.deleteLogo);

router.get('/provider/types', settings.providerTypes);
router.get('/provider', settings.getProvider);
router.put('/provider', settings.saveProvider);
router.post('/provider/test', rateLimit({ name: 'provider-test', windowSec: 300, max: 10, key: tenantKey }), settings.testProvider);
router.get('/provider/balance', rateLimit({ name: 'provider-balance', windowSec: 300, max: 20, key: tenantKey }), settings.balance);
router.post('/provider/webhook-token', settings.regenerateWebhook);

module.exports = router;
