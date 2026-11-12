'use strict';
const env = require('../../config/env');
const ArkeselProvider = require('./arkesel');
const MockProvider = require('./mock');
const { E } = require('../../utils/errors');

// Registry. Add new providers here.
const REGISTRY = { arkesel: ArkeselProvider, mock: MockProvider };

function listProviders() {
  return Object.values(REGISTRY)
    .map((P) => P.meta)
    .filter((m) => m.id !== 'mock' || env.sms.allowMock);
}

function getProviderMeta(id) {
  const P = REGISTRY[id];
  if (!P || (id === 'mock' && !env.sms.allowMock)) throw E.badRequest('Unsupported SMS provider');
  return P.meta;
}

/** @param {string} id @param {object} credentials decrypted @param {object} context */
function createProvider(id, credentials, context) {
  const P = REGISTRY[id];
  if (!P || (id === 'mock' && !env.sms.allowMock)) throw new Error(`Unsupported SMS provider: ${id}`);
  return new P(credentials, context);
}

module.exports = { listProviders, getProviderMeta, createProvider, REGISTRY };
