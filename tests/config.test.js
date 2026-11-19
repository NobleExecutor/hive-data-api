import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, PROJECT_ROOT } from '../src/config.js';

const KEY = 'k'.repeat(64);

describe('config', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig({ API_KEY: KEY });
    expect(config).toMatchObject({
      port: 3000,
      host: '127.0.0.1',
      timezone: 'Europe/Paris',
      maxHives: 200,
      historyDays: 30,
      seriesPath: path.join(PROJECT_ROOT, 'data/series.sample.json'),
      dbPath: path.join(PROJECT_ROOT, 'data/api.db'),
    });
  });

  it('refuse une clé absente ou trop courte, sans jamais l\'afficher', () => {
    expect(() => loadConfig({})).toThrow(/API_KEY est absente/);
    const shortKey = 'secret-trop-court';
    try {
      loadConfig({ API_KEY: shortKey });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).toMatch(/trop courte/);
      expect(err.message).not.toContain(shortKey);
    }
  });

  it('refuse des nombres et un fuseau invalides', () => {
    expect(() => loadConfig({ API_KEY: KEY, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ API_KEY: KEY, MAX_HIVES: '0' })).toThrow(/MAX_HIVES/);
    expect(() => loadConfig({ API_KEY: KEY, TZ: 'Mars/Olympus' })).toThrow(/TZ/);
  });

  it('lit TRUST_PROXY (loopback par défaut) et refuse une valeur invalide', () => {
    expect(loadConfig({ API_KEY: KEY }).trustProxy).toBe('loopback');
    expect(loadConfig({ API_KEY: KEY, TRUST_PROXY: 'loopback, uniquelocal' }).trustProxy)
      .toBe('loopback, uniquelocal');
    expect(loadConfig({ API_KEY: KEY, TRUST_PROXY: '172.16.0.0/12' }).trustProxy).toBe('172.16.0.0/12');
    expect(() => loadConfig({ API_KEY: KEY, TRUST_PROXY: 'caddy' })).toThrow(/TRUST_PROXY/);
  });

  it('accepte les chemins absolus', () => {
    expect(loadConfig({ API_KEY: KEY, DB_PATH: '/tmp/x.db' }).dbPath).toBe('/tmp/x.db');
  });
});
