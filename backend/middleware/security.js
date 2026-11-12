'use strict';
const helmet = require('helmet');
const crypto = require('crypto');
const env = require('../config/env');
const { E } = require('../utils/errors');

const helmetMw = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
});

/** Redirect plain HTTP to HTTPS in production (Render terminates TLS and sets X-Forwarded-Proto). */
function enforceHttps(req, res, next) {
  if (!env.isProd || req.secure || req.path === '/healthz' || req.path === '/readyz') return next();
  const host = req.headers.host;
  if (!host) return next(E.badRequest('Host header required'));
  return res.redirect(308, `https://${host}${req.originalUrl}`);
}

function requestId(req, res, next) {
  req.id = crypto.randomBytes(8).toString('hex');
  res.set('X-Request-Id', req.id);
  next();
}

/** Block cross-site state-changing requests: Origin (when present) must match our Host. */
function originCheck(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/webhooks/')) return next(); // server-to-server, authenticated by secret path token
  const origin = req.headers.origin;
  if (!origin) return next();
  let host;
  try { host = new URL(origin).host; } catch { return next(E.forbidden('Invalid origin', 'BAD_ORIGIN')); }
  if (host !== req.headers.host) return next(E.forbidden('Cross-site request blocked', 'BAD_ORIGIN'));
  return next();
}

const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

module.exports = { helmetMw, enforceHttps, requestId, originCheck, noStore };
