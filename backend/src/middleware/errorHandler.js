/**
 * Centralised error handler. Controllers throw errors with `.status` and
 * `.code` properties (e.g. via Object.assign(new Error(...), {status, code}))
 * for expected business-rule violations; anything else is treated as a 500.
 * Must be registered LAST in the middleware chain.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status === 500 ? 'An unexpected error occurred.' : err.message;

  if (status === 500) {
    // eslint-disable-next-line no-console
    console.error('[ERROR]', req.method, req.originalUrl, err);
  }

  return res.status(status).json({
    success: false,
    error: { code, message, details: err.meta || undefined },
  });
}

module.exports = { errorHandler };
