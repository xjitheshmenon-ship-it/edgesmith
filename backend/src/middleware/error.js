// Centralised async wrapper + error handler.
// Mirrors the prior backend's FastAPI-style error body: { detail: "..." }.
import { HttpError } from './auth.js';

// Wrap an async route handler so thrown errors flow to the error middleware.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(req, res) {
  res.status(404).json({ detail: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ detail: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  // Postgres unique violation → 400 with a readable message
  if (err && err.code === '23505') {
    return res.status(400).json({ detail: 'Duplicate value violates a unique constraint' });
  }
  if (err && err.code === '23503') {
    return res.status(400).json({ detail: 'Referenced record does not exist' });
  }
  console.error('[error]', err);
  res.status(500).json({ detail: 'Internal server error' });
}
