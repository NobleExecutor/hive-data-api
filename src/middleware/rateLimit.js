import rateLimit from 'express-rate-limit';
import { errorBody } from './errors.js';

export const DEFAULT_RATE_LIMITS = Object.freeze({
  windowMs: 15 * 60 * 1000,
  global: 600, // toutes les routes, par IP et par fenêtre
  write: 60, // POST et DELETE
});

function limiter(windowMs, limit) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json(errorBody('too_many_requests', 'Trop de requêtes, réessayez plus tard.'));
    },
  });
}

export function createRateLimiters(options = {}) {
  const { windowMs, global, write } = { ...DEFAULT_RATE_LIMITS, ...options };
  return {
    globalLimiter: limiter(windowMs, global),
    writeLimiter: limiter(windowMs, write),
  };
}
