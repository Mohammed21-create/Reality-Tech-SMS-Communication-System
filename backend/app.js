'use strict';
const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { helmetMw, enforceHttps, requestId, originCheck, noStore } = require('./middleware/security');
const { errorHandler, notFoundApi } = require('./middleware/errorHandler');
const { rateLimit } = require('./middleware/rateLimit');
const { sanitizeInput } = require('./utils/sanitize');
const health = require('./controllers/healthController');
const webhook = require('./controllers/webhookController');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy); // so req.ip / req.secure are right behind Render's proxy

  app.use(requestId);
  app.get('/healthz', health.live);
  app.get('/readyz', health.ready);
  app.use(enforceHttps);
  app.use(helmetMw);
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(sanitizeInput);
  app.use(originCheck);

  app.use('/api', noStore, rateLimit({ name: 'api', windowSec: 60, max: 600 }));
  app.post('/api/webhooks/sms/:provider/:token', rateLimit({ name: 'webhook', windowSec: 60, max: 600 }), webhook.deliveryReport);
  app.get('/api/webhooks/sms/:provider/:token', rateLimit({ name: 'webhook', windowSec: 60, max: 600 }), webhook.deliveryReport);
  app.use('/api/admin', require('./routes/adminRoutes'));
  app.use('/api/school', require('./routes/schoolRoutes'));
  app.use('/api', notFoundApi);

  const frontend = path.join(__dirname, '..', 'frontend');
  app.use(express.static(frontend, {
    extensions: ['html'],
    index: 'index.html',
    setHeaders(res, file) {
      // Always revalidate so deployments show up immediately; the service worker handles offline caching.
      if (/\.(html|js|css|json)$/.test(file)) res.set('Cache-Control', 'no-cache');
      else res.set('Cache-Control', 'public, max-age=86400');
      if (file.endsWith('service-worker.js')) res.set('Service-Worker-Allowed', '/');
    },
  }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
