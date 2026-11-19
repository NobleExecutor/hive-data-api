import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IANAZone } from 'luxon';

/** Racine du projet : les chemins relatifs du .env sont résolus depuis ici. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIN_API_KEY_LENGTH = 32;

export class ConfigError extends Error {
  constructor(problems) {
    super(`Configuration invalide :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function readInt(env, name, defaultValue, min, max, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${name} doit être un entier (reçu : « ${raw} »)`);
    return defaultValue;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problems.push(`${name} doit être compris entre ${min} et ${max} (reçu : ${value})`);
  }
  return value;
}

function readPath(env, name, defaultValue) {
  const raw = env[name] || defaultValue;
  return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

/**
 * Lit et valide la configuration. Lève une ConfigError listant tous les problèmes.
 * La valeur de API_KEY n'apparaît jamais dans les messages.
 */
export function loadConfig(env = process.env) {
  const problems = [];

  const apiKey = env.API_KEY ?? '';
  if (apiKey === '') {
    problems.push('API_KEY est absente (générer une clé avec `openssl rand -hex 32`)');
  } else if (apiKey.length < MIN_API_KEY_LENGTH) {
    problems.push(
      `API_KEY est trop courte (${MIN_API_KEY_LENGTH} caractères minimum, générer avec \`openssl rand -hex 32\`)`,
    );
  }

  const timezone = env.TZ || 'Europe/Paris';
  if (!IANAZone.isValidZone(timezone)) {
    problems.push(`TZ n'est pas un fuseau valide (reçu : « ${timezone} »)`);
  }

  const config = {
    port: readInt(env, 'PORT', 3000, 1, 65535, problems),
    host: env.HOST || '127.0.0.1',
    apiKey,
    timezone,
    seriesPath: readPath(env, 'SERIES_PATH', 'data/series.sample.json'),
    dbPath: readPath(env, 'DB_PATH', 'data/api.db'),
    maxHives: readInt(env, 'MAX_HIVES', 200, 1, 100000, problems),
    historyDays: readInt(env, 'HISTORY_DAYS', 30, 0, 3650, problems),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(config);
}
