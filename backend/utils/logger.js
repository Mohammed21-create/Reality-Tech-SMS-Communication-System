'use strict';
// Minimal structured JSON logger with secret redaction. Render collects stdout/stderr.
const SENSITIVE = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|csrf|hash|encrypted)/i;

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…';
  return value;
}

function write(level, msg, meta) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = { t: new Date().toISOString(), level, msg, ...(meta ? redact(meta) : {}) };
  const out = JSON.stringify(line);
  (level === 'error' ? process.stderr : process.stdout).write(out + '\n');
}

module.exports = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  debug: (m, meta) => { if (process.env.LOG_LEVEL === 'debug') write('debug', m, meta); },
  redact,
};
