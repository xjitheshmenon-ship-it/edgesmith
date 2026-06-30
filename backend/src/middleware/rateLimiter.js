/**
 * Minimal in-memory rate limiter (no Redis dependency needed at this scale —
 * single backend process per Hetzner deployment guidance in the technical
 * instructions). Keyed by IP + route prefix.
 */
function rateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map(); // key -> [timestamps]

  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);

    if (arr.length > max) {
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      });
    }
    return next();
  };
}

module.exports = { rateLimiter };
