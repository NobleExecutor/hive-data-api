import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { PROJECT_ROOT } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { loadSeriesFile } from '../src/engine/series.js';

const API_KEY = 'test-key-0123456789abcdef0123456789abcdef';
const ZONE = 'Europe/Paris';
const pool = loadSeriesFile(path.join(PROJECT_ROOT, 'data/series.sample.json'));
const paris = (iso) => DateTime.fromISO(iso, { zone: ZONE });

function setup({ maxHives = 200, rateLimits = { global: 10_000, write: 10_000 } } = {}) {
  const clock = { now: paris('2026-11-19T15:00') };
  const app = createApp({
    apiKey: API_KEY,
    db: openDatabase(':memory:'),
    pool,
    maxHives,
    historyDays: 30,
    zone: ZONE,
    clock: () => clock.now,
    rateLimits,
  });
  const api = {
    get: (url) => request(app).get(`/api/v1${url}`).set('X-API-Key', API_KEY),
    post: (url, body) => request(app).post(`/api/v1${url}`).set('X-API-Key', API_KEY).send(body),
    del: (url) => request(app).delete(`/api/v1${url}`).set('X-API-Key', API_KEY),
  };
  return { app, api, clock };
}

const GPS = [48.85, 2.35];

describe('API', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  describe('health et authentification', () => {
    it('GET /health répond sans clé', async () => {
      const res = await request(ctx.app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('401 sans clé ou avec une mauvaise clé', async () => {
      const missing = await request(ctx.app).get('/api/v1/hives');
      expect(missing.status).toBe(401);
      expect(missing.body.error.code).toBe('unauthorized');

      const wrong = await request(ctx.app).get('/api/v1/hives').set('X-API-Key', 'nope');
      expect(wrong.status).toBe(401);

      const almost = await request(ctx.app).get('/api/v1/hives').set('X-API-Key', `${API_KEY}x`);
      expect(almost.status).toBe(401);
    });

    it('401 avant de lire le corps d\'un POST', async () => {
      const res = await request(ctx.app).post('/api/v1/hives').set('Content-Type', 'application/json').send('{oops');
      expect(res.status).toBe(401);
    });

    it('applique les en-têtes helmet et masque Express', async () => {
      const res = await request(ctx.app).get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('404 au format d\'erreur pour une route inconnue', async () => {
      const res = await ctx.api.get('/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
    });
  });

  describe('ruches', () => {
    it('POST /hives → 201 avec created_at et history_start', async () => {
      const res = await ctx.api.post('/hives', { serial: '000004', gps: GPS });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        serial: '000004',
        gps: GPS,
        created_at: '2026-11-19T15:00:00+01:00',
        history_start: '2026-10-20T00:00:00+02:00',
      });
    });

    it('409 hive_exists si le numéro est déjà pris', async () => {
      await ctx.api.post('/hives', { serial: '000004', gps: GPS });
      const res = await ctx.api.post('/hives', { serial: '000004', gps: GPS });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('hive_exists');
    });

    it('409 hive_limit au-delà de MAX_HIVES', async () => {
      const { api } = setup({ maxHives: 1 });
      await api.post('/hives', { serial: '000001', gps: GPS });
      const res = await api.post('/hives', { serial: '000002', gps: GPS });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('hive_limit');
    });

    it.each([
      ['numéro trop court', { serial: '1234', gps: GPS }],
      ['numéro non numérique', { serial: '12a456', gps: GPS }],
      ['latitude hors bornes', { serial: '000004', gps: [91, 2] }],
      ['longitude hors bornes', { serial: '000004', gps: [48, -181] }],
      ['gps à 3 valeurs', { serial: '000004', gps: [48, 2, 3] }],
    ])('422 : %s', async (_label, body) => {
      const res = await ctx.api.post('/hives', body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('validation_error');
    });

    it.each([
      ['champ inconnu', { serial: '000004', gps: GPS, owner: 'x' }],
      ['champ manquant', { serial: '000004' }],
      ['mauvais type', { serial: 4, gps: GPS }],
      ['corps absent', undefined],
    ])('400 : %s', async (_label, body) => {
      const res = await ctx.api.post('/hives', body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    });

    it('400 pour un JSON mal formé, 413 au-delà de 10 Ko', async () => {
      const bad = await ctx.api.post('/hives').set('Content-Type', 'application/json').send('{"serial":');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('invalid_json');

      const big = await ctx.api.post('/hives', { serial: '000004', gps: GPS, pad: 'x'.repeat(11 * 1024) });
      expect(big.status).toBe(413);
    });

    it('GET /hives et GET /hives/:serial', async () => {
      await ctx.api.post('/hives', { serial: '000010', gps: GPS });
      await ctx.api.post('/hives', { serial: '000002', gps: [-33.9, 151.2] });

      const list = await ctx.api.get('/hives');
      expect(list.status).toBe(200);
      expect(list.body.hives.map((h) => h.serial)).toEqual(['000002', '000010']);

      const one = await ctx.api.get('/hives/000002');
      expect(one.status).toBe(200);
      expect(one.body.gps).toEqual([-33.9, 151.2]);

      expect((await ctx.api.get('/hives/999999')).status).toBe(404);
      expect((await ctx.api.get('/hives/abc')).status).toBe(422);
    });

    it('DELETE /hives/:serial → 204 puis 404', async () => {
      await ctx.api.post('/hives', { serial: '000004', gps: GPS });
      expect((await ctx.api.del('/hives/000004')).status).toBe(204);
      expect((await ctx.api.del('/hives/000004')).status).toBe(404);
      expect((await ctx.api.get('/hives/000004')).status).toBe(404);
    });
  });

  describe('relevés', () => {
    beforeEach(async () => {
      await ctx.api.post('/hives', { serial: '000004', gps: GPS });
      await ctx.api.post('/hives', { serial: '000005', gps: [45.76, 4.83] });
    });

    it('30 jours d\'historique dès la création, au format source', async () => {
      const res = await ctx.api.get('/hives/000004/readings');
      expect(res.status).toBe(200);
      const { gps, data } = res.body['000004'];
      expect(gps).toEqual(GPS);
      expect(data).toHaveLength(61);
      expect(data[0]).toEqual({
        date: '2026-10-20T08:00:00',
        temperature: expect.any(Number),
        poids: expect.any(Number),
        humidite: expect.any(Number),
        frequence: expect.any(Number),
      });
      expect(data.at(-1).date).toBe('2026-11-19T08:00:00');
    });

    it('même requête → mêmes valeurs', async () => {
      const a = await ctx.api.get('/hives/000004/readings');
      const b = await ctx.api.get('/hives/000004/readings');
      expect(a.body).toEqual(b.body);
    });

    it('filtre from / to (date seule pour to = toute la journée)', async () => {
      const res = await ctx.api.get('/hives/000004/readings?from=2026-11-01&to=2026-11-02');
      expect(res.body['000004'].data.map((r) => r.date)).toEqual([
        '2026-11-01T08:00:00', '2026-11-01T20:00:00', '2026-11-02T08:00:00', '2026-11-02T20:00:00',
      ]);
    });

    it('422 pour une date invalide ou from > to, 400 pour un paramètre inconnu', async () => {
      expect((await ctx.api.get('/hives/000004/readings?from=hier')).status).toBe(422);
      expect((await ctx.api.get('/hives/000004/readings?from=2026-11-10&to=2026-11-01')).status).toBe(422);
      expect((await ctx.api.get('/hives/000004/readings?limit=5')).status).toBe(400);
      expect((await ctx.api.get('/hives/999999/readings')).status).toBe(404);
    });

    it('GET /readings sans since : tout depuis history_start', async () => {
      const res = await ctx.api.get('/readings?serials=000004,000005');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['000004', '000005']);
      expect(res.body['000005'].gps).toEqual([45.76, 4.83]);
      expect(res.body['000004'].data).toHaveLength(61);
    });

    it('GET /readings avec since : strictement après, et seulement les nouveaux créneaux', async () => {
      const first = await ctx.api.get('/readings?serials=000004');
      const last = first.body['000004'].data.at(-1).date;

      const same = await ctx.api.get(`/readings?serials=000004&since=${last}`);
      expect(same.body['000004'].data).toEqual([]);

      ctx.clock.now = paris('2026-11-20T08:05'); // cron du lendemain matin
      const next = await ctx.api.get(`/readings?serials=000004&since=${last}`);
      expect(next.body['000004'].data.map((r) => r.date)).toEqual(['2026-11-19T20:00:00', '2026-11-20T08:00:00']);

      // les relevés déjà synchronisés n'ont pas changé
      const all = await ctx.api.get('/readings?serials=000004');
      expect(all.body['000004'].data.slice(0, 61)).toEqual(first.body['000004'].data);
    });

    it('GET /readings : validation des numéros', async () => {
      expect((await ctx.api.get('/readings')).status).toBe(400);
      expect((await ctx.api.get('/readings?serials=')).status).toBe(422);
      expect((await ctx.api.get('/readings?serials=12345')).status).toBe(422);
      expect((await ctx.api.get('/readings?serials=000004&since=pas-une-date')).status).toBe(422);

      const unknown = await ctx.api.get('/readings?serials=000004,999999');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('hive_not_found');

      const tooMany = Array.from({ length: 51 }, (_, i) => String(i).padStart(6, '0')).join(',');
      const res = await ctx.api.get(`/readings?serials=${tooMany}`);
      expect(res.status).toBe(422);
    });
  });

  describe('rate limit', () => {
    it('429 au-delà de la limite d\'écriture', async () => {
      const { api } = setup({ rateLimits: { global: 100, write: 2 } });
      await api.post('/hives', { serial: '000001', gps: GPS });
      await api.post('/hives', { serial: '000002', gps: GPS });
      const res = await api.post('/hives', { serial: '000003', gps: GPS });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('too_many_requests');
      expect((await api.get('/hives')).status).toBe(200);
    });

    it('429 au-delà de la limite globale', async () => {
      const { api } = setup({ rateLimits: { global: 2, write: 100 } });
      await api.get('/hives');
      await api.get('/hives');
      expect((await api.get('/hives')).status).toBe(429);
    });
  });
});
