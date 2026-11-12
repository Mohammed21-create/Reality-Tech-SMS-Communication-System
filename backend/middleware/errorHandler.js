'use strict';
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err && err.name === 'ValidationError' && err.errors) {
    status = 400; code = 'VALIDATION_ERROR'; message = 'Some fields are invalid';
    details = Object.values(err.errors).map((e) => e.message);
  } else if (err && err.name === 'CastError') {
    status = 400; code = 'BAD_REQUEST'; message = 'Invalid identifier or value';
  } else if (err && (err.code === 11000 || err.code === 11001)) {
    status = 409; code = 'DUPLICATE'; message = 'A record with these details already exists';
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_JSON'; message = 'Request body is not valid JSON';
  } else if (err && err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request is too large';
  } else if (err && err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400; code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed';
  }

  if (status >= 500) logger.error('request_failed', { id: req.id, method: req.method, path: req.path, message: err && err.message, stack: process.env.NODE_ENV === 'production' ? undefined : err && err.stack });
  if (res.headersSent) return undefined;
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}

module.exports = { errorHandler, notFoundApi };
