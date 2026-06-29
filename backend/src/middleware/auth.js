// JWT auth + password hashing + role guards.
// Tokens are issued as Bearer tokens (Authorization header) to match the SPA client.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { one } from '../db/pool.js';

const ALGO = 'HS256';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hashed) {
  try {
    return bcrypt.compareSync(plain, hashed);
  } catch {
    return false;
  }
}

export function createAccessToken(payload) {
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: ALGO,
    expiresIn: `${config.accessTokenExpireMinutes}m`,
  });
}

// HttpError helper so route handlers can throw { status, message }.
export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token; // tolerate cookie auth too
  return null;
}

async function loadUserFromToken(req) {
  const token = extractToken(req);
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: [ALGO] });
  } catch {
    return null;
  }
  if (!payload?.sub) return null;
  return one(
    'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
    [payload.sub]
  );
}

// Require a valid, active user. Attaches req.user.
export function requireAuth(req, res, next) {
  loadUserFromToken(req)
    .then((user) => {
      if (!user) throw new HttpError(401, 'Could not validate credentials');
      req.user = user;
      next();
    })
    .catch(next);
}

// Require one of the given roles (implies auth).
export function requireRoles(...roles) {
  return (req, res, next) => {
    loadUserFromToken(req)
      .then((user) => {
        if (!user) throw new HttpError(401, 'Could not validate credentials');
        if (!roles.includes(user.role)) throw new HttpError(403, 'Insufficient permissions');
        req.user = user;
        next();
      })
      .catch(next);
  };
}

// Optional auth — attaches req.user if a valid token is present, never blocks.
export function optionalAuth(req, res, next) {
  loadUserFromToken(req)
    .then((user) => {
      req.user = user || null;
      next();
    })
    .catch(() => {
      req.user = null;
      next();
    });
}

export const requireAdmin = requireRoles('admin');
export const requireManager = requireRoles('admin', 'manager');
export const requireSupervisor = requireRoles('admin', 'manager', 'supervisor');
export const requireOperator = requireRoles('admin', 'manager', 'supervisor', 'operator');
