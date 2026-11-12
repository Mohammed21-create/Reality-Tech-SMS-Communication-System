'use strict';
const mongoose = require('mongoose');

// Server-side sessions: the cookie holds a random id; only its SHA-256 is stored here.
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  realm: { type: String, enum: ['admin', 'school'], required: true },
  schoolId: { type: mongoose.Schema.Types.ObjectId },
  csrfToken: { type: String, required: true },
  ip: String,
  userAgent: { type: String, maxlength: 300 },
  lastActivityAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }, // absolute lifetime
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ lastActivityAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }); // housekeeping for abandoned sessions

module.exports = mongoose.model('Session', schema);
