/**
 * Centralised error handler. Controllers throw errors with `.status` and
 * `.code` properties (e.g. via Object.assign(new Error(...), {status, code}))
 * for expected business-rule violations; anything else is treated as a 500.
 * Must be registered LAST in the middleware chain.
 */
/**
 * Translate a raw PostgreSQL error (SQLSTATE in err.code) into a user-facing
 * message + an appropriate 4xx status, so constraint violations surface a clear
 * reason instead of a generic 500 "unexpected error". Returns null for anything
 * that isn't a recognised DB error.
 */
function translatePgError(err) {
  // node-postgres errors carry a 5-char SQLSTATE in .code plus .detail/.column/.constraint
  const sqlstate = typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : null;
  if (!sqlstate) return null;
  switch (sqlstate) {
    case '23505': // unique_violation
      return { status: 409, code: 'DUPLICATE', message: 'That value already exists — it must be unique.' };
    case '23503': // foreign_key_violation
      return { status: 409, code: 'IN_USE', message: 'This record is referenced by other data, so it cannot be changed or removed. Archive it instead.' };
    case '23502': // not_null_violation
      return { status: 400, code: 'MISSING_FIELD', message: `A required field is missing${err.column ? `: ${err.column}` : ''}.` };
    case '23514': // check_violation
      return { status: 400, code: 'INVALID_VALUE', message: 'A value is outside the allowed range or set of options.' };
    case '22P02': // invalid_text_representation
    case '22003': // numeric_value_out_of_range
      return { status: 400, code: 'INVALID_VALUE', message: 'A field has an invalid value (a number was expected).' };
    default:
      return sqlstate.startsWith('23') ? { status: 400, code: 'CONSTRAINT', message: 'The change violates a data rule and was not saved.' } : null;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const translated = err.status ? null : translatePgError(err);
  const status = err.status || translated?.status || 500;
  const code = translated?.code || err.code || 'INTERNAL_ERROR';
  const message = translated?.message || (status === 500 ? 'An unexpected error occurred.' : err.message);

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
