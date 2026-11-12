'use strict';
const { SmsProviderConfig } = require('../models');
const { sha256 } = require('../utils/crypto');
const { createProvider, REGISTRY } = require('../services/sms');
const { applyDeliveryUpdates } = require('../services/deliveryService');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/** Provider delivery receipts. The secret token in the URL identifies (and authenticates) the school. */
exports.deliveryReport = asyncHandler(async (req, res) => {
  const { provider, token } = req.params;
  if (!REGISTRY[provider] || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  const cfg = await SmsProviderConfig.findOne({ webhookTokenHash: sha256(token), provider }).setOptions({ skipTenantGuard: true }).select('schoolId provider');
  if (!cfg) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  const parser = createProvider(provider, {}, {});
  const updates = parser.parseWebhook(req).filter((u) => u.status === 'delivered' || u.status === 'failed');
  const applied = await applyDeliveryUpdates({ schoolId: cfg.schoolId, provider, updates, source: 'webhook' });
  logger.info('dlr_webhook', { provider, received: updates.length, applied });
  return res.json({ ok: true });
});
