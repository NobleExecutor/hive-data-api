import express from 'express';
import helmet from 'helmet';
import { DateTime } from 'luxon';
import { createHivesRepo } from './db/hivesRepo.js';
import { createEngine } from './engine/generator.js';
import { DEFAULT_ZONE } from './engine/slots.js';
import { requireApiKey } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { createHealthRouter } from './routes/health.js';
import { createHivesRouter } from './routes/hives.js';
import { createReadingsRouter } from './routes/readings.js';

export const API_PREFIX = '/api/v1';

/**
 * Crée l'application Express (sans écouter de port : utilisée telle quelle par les tests).
 * @param {object} options
 * @param {string} options.apiKey
 * @param {import('better-sqlite3').Database} options.db
 * @param {object} options.pool         pool de séries (engine/series.js)
 * @param {number} [options.maxHives]
 * @param {number} [options.historyDays]
 * @param {string} [options.zone]
 * @param {() => DateTime} [options.clock]  horloge injectable (tests)
 * @param {object} [options.rateLimits]     { windowMs, global, write }
 * @param {(line: string) => void} [options.log]  journal d'accès (sans corps ni query)
 */
export function createApp({
  apiKey,
  db,
  pool,
  maxHives = 200,
  historyDays = 30,
  zone = DEFAULT_ZONE,
  clock = () => DateTime.now(),
  rateLimits = {},
  log = null,
}) {
  if (!apiKey) throw new Error('createApp : apiKey est requise.');

  const repo = createHivesRepo(db);
  const engine = createEngine({ pool, zone });
  const { globalLimiter, writeLimiter } = createRateLimiters(rateLimits);

  const app = express();
  app.set('trust proxy', 'loopback'); // Nginx en local : l'IP du client vient de X-Forwarded-For
  app.use(helmet());

  if (log) {
    app.use((req, res, next) => {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }

  const api = express.Router();
  api.use(globalLimiter);
  api.use(createHealthRouter());
  api.use(requireApiKey(apiKey));
  api.use(express.json({ limit: '10kb' }));
  api.use(createHivesRouter({ repo, clock, zone, maxHives, historyDays, writeLimiter }));
  api.use(createReadingsRouter({ repo, engine, clock, zone }));

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
