'use strict';
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}
const E = {
  badRequest: (msg = 'Invalid request', details, code = 'BAD_REQUEST') => new AppError(400, code, msg, details),
  unauthorized: (msg = 'Authentication required', code = 'UNAUTHENTICATED') => new AppError(401, code, msg),
  forbidden: (msg = 'You do not have permission to do that', code = 'FORBIDDEN') => new AppError(403, code, msg),
  notFound: (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg),
  conflict: (msg = 'Conflict', details, code = 'CONFLICT') => new AppError(409, code, msg, details),
  tooMany: (msg = 'Too many requests. Please try again later.') => new AppError(429, 'RATE_LIMITED', msg),
};
module.exports = { AppError, E };
