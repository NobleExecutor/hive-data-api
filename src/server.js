import path from 'node:path';
import dotenv from 'dotenv';
import { ConfigError, loadConfig, PROJECT_ROOT } from './config.js';
import { openDatabase } from './db/database.js';
import { loadSeriesFile, SeriesError } from './engine/series.js';
import { createApp } from './app.js';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

function fail(message) {
  console.error(`[hive-data-api] Démarrage impossible.\n${message}`);
  process.exit(1);
}

let config;
let pool;
try {
  config = loadConfig();
  pool = loadSeriesFile(config.seriesPath);
} catch (err) {
  if (err instanceof ConfigError || err instanceof SeriesError) fail(err.message);
  throw err;
}

const db = openDatabase(config.dbPath);
const app = createApp({
  apiKey: config.apiKey,
  db,
  pool,
  maxHives: config.maxHives,
  historyDays: config.historyDays,
  zone: config.timezone,
  trustProxy: config.trustProxy,
  log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
});

const server = app.listen(config.port, config.host, () => {
  console.log(
    `[hive-data-api] En écoute sur http://${config.host}:${config.port} `
      + `(${pool.ids.length} série(s) de référence, fichier ${path.basename(config.seriesPath)})`,
  );
});

server.on('error', (err) => fail(err.message));

function shutdown(signal) {
  console.log(`[hive-data-api] ${signal} reçu, arrêt.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
