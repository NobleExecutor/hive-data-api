import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { buildPool, loadSeriesFile, SeriesError } from '../src/engine/series.js';
import { createEngine, fnv1a } from '../src/engine/generator.js';
import { computeHistoryStart, listSlots } from '../src/engine/slots.js';
import { PROJECT_ROOT } from '../src/config.js';

const ZONE = 'Europe/Paris';
const paris = (iso) => DateTime.fromISO(iso, { zone: ZONE });
const pool = loadSeriesFile(path.join(PROJECT_ROOT, 'data/series.sample.json'));
const engine = createEngine({ pool, zone: ZONE });

const hiveCreatedAt = (serial, createdIso, historyDays = 30) => ({
  serial,
  history_start: computeHistoryStart(paris(createdIso), historyDays, ZONE).toISO(),
});

/** Série synthétique couvrant une année bissextile complète (2024). */
function yearPool() {
  const data = [];
  for (let d = DateTime.fromISO('2024-01-01', { zone: 'UTC' }); d.year === 2024; d = d.plus({ days: 1 })) {
    for (const hour of ['08', '20']) {
      data.push({
        date: `${d.toISODate()}T${hour}:00:00`,
        // valeur de température = numéro du mois, pour vérifier la correspondance par date
        temperature: d.month * 10 + (d.day === 28 && d.month === 2 ? 5 : 0),
        poids: 15,
        humidite: 80,
        frequence: 200,
      });
    }
  }
  return buildPool({ 999999: { data } });
}

afterEach(() => vi.restoreAllMocks());

describe('chargement des séries', () => {
  it('charge le fichier d\'exemple (3 séries)', () => {
    expect(pool.ids).toEqual(['000001', '000002', '000003']);
    expect(pool.series[0].days).toHaveLength(14);
  });

  it('refuse un fichier absent', () => {
    expect(() => loadSeriesFile('/nope/series.json')).toThrow(SeriesError);
  });

  it('refuse un contenu invalide', () => {
    expect(() => buildPool({})).toThrow(/aucune série/);
    expect(() => buildPool({ 1: { data: [] } })).toThrow(SeriesError);
    expect(() => buildPool({ 1: { data: [{ date: 'x', temperature: 1, poids: 1, humidite: 1, frequence: 1 }] } }))
      .toThrow(/date invalide/);
    expect(() => buildPool({ 1: { data: [{ date: '2024-01-01T08:00:00', temperature: 'chaud' }] } }))
      .toThrow(SeriesError);
  });

  it('comble un créneau manquant avec le relevé précédent', () => {
    const p = buildPool({
      1: {
        data: [
          { date: '2024-01-01T08:00:00', temperature: 20, poids: 15, humidite: 80, frequence: 200 },
          { date: '2024-01-03T20:00:00', temperature: 22, poids: 16, humidite: 82, frequence: 210 },
        ],
      },
    });
    const { days } = p.series[0];
    expect(days).toHaveLength(3);
    expect(days[1].slots[8].temperature).toBe(20);
    expect(days[2].slots[20].temperature).toBe(22);
  });
});

describe('créneaux', () => {
  it('ne produit que 08:00 et 20:00, bornes incluses', () => {
    const slots = listSlots(paris('2026-11-18T08:00'), paris('2026-11-19T20:00'), ZONE);
    expect(slots.map((s) => s.toFormat('dd HH:mm'))).toEqual(['18 08:00', '18 20:00', '19 08:00', '19 20:00']);
  });

  it('gère les changements d\'heure (mars et octobre)', () => {
    for (const [from, to] of [['2026-03-28T00:00', '2026-03-30T23:00'], ['2026-10-24T00:00', '2026-10-26T23:00']]) {
      const slots = listSlots(paris(from), paris(to), ZONE);
      expect(slots).toHaveLength(6);
      expect(new Set(slots.map((s) => s.toFormat('HH:mm')))).toEqual(new Set(['08:00', '20:00']));
    }
    // Le jour du passage à l'heure d'été, 08:00 Paris = 06:00 UTC (contre 07:00 la veille).
    const [before, , after] = listSlots(paris('2026-03-28T00:00'), paris('2026-03-29T23:00'), ZONE);
    expect(before.toUTC().hour).toBe(7);
    expect(after.toUTC().hour).toBe(6);
  });

  it('history_start = created_at − 30 jours, à 00:00', () => {
    const start = computeHistoryStart(paris('2026-11-19T15:42'), 30, ZONE);
    expect(start.toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-10-20T00:00');
  });
});

describe('moteur de génération', () => {
  const slot = paris('2026-11-19T08:00');

  it('est déterministe : même requête → mêmes valeurs', () => {
    const hive = hiveCreatedAt('000004', '2026-11-19T15:00');
    const now = paris('2026-11-19T15:00');
    expect(engine.readingsFor(hive, { now })).toEqual(engine.readingsFor(hive, { now }));
    expect(createEngine({ pool, zone: ZONE }).readingAt('000004', slot)).toEqual(engine.readingAt('000004', slot));
  });

  it('n\'utilise jamais Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    engine.readingsFor(hiveCreatedAt('123456', '2026-11-19T15:00'), { now: paris('2026-11-19T15:00') });
    expect(spy).not.toHaveBeenCalled();
  });

  it('choisit la série source par hash du numéro', () => {
    expect(engine.seriesFor('000004').id).toBe(pool.ids[fnv1a('000004') % pool.ids.length]);
    expect(fnv1a('000004')).toBe(fnv1a('000004'));
  });

  it('donne des valeurs différentes à des ruches différentes', () => {
    const values = new Set(
      ['000001', '000002', '000003', '000004', '000005', '000006'].map((s) => JSON.stringify(engine.readingAt(s, slot))),
    );
    expect(values.size).toBeGreaterThan(1);
  });

  it('respecte les bornes, les types et la proximité avec la référence', () => {
    for (let i = 0; i < 300; i += 1) {
      const serial = String(i * 3331).padStart(6, '0');
      const r = engine.readingAt(serial, paris('2026-10-01T20:00').plus({ days: i % 40 }));
      expect(Number.isInteger(r.temperature)).toBe(true);
      expect(Number.isInteger(r.humidite)).toBe(true);
      expect(Number.isInteger(r.frequence)).toBe(true);
      expect(Math.round(r.poids * 10) / 10).toBe(r.poids);
      expect(r.poids).toBeGreaterThan(0);
      expect(r.humidite).toBeGreaterThanOrEqual(0);
      expect(r.humidite).toBeLessThanOrEqual(100);
      // référence (20–23 °C) ± personnalité 1 ± bruit 1, arrondi
      expect(r.temperature).toBeGreaterThanOrEqual(18);
      expect(r.temperature).toBeLessThanOrEqual(25);
      expect(r.poids).toBeGreaterThanOrEqual(11.9);
      expect(r.poids).toBeLessThanOrEqual(19.1);
      expect(r.frequence).toBeGreaterThanOrEqual(180);
      expect(r.frequence).toBeLessThanOrEqual(270);
    }
  });

  it('borne poids et humidité même avec des références extrêmes', () => {
    const extreme = createEngine({
      pool: buildPool({ 1: { data: [{ date: '2024-01-01T08:00:00', temperature: 0, poids: 0, humidite: 100, frequence: 0 }] } }),
      zone: ZONE,
    });
    for (let i = 0; i < 50; i += 1) {
      const r = extreme.readingAt(String(i).padStart(6, '0'), slot);
      expect(r.poids).toBeGreaterThan(0);
      expect(r.humidite).toBeLessThanOrEqual(100);
      expect(r.frequence).toBeGreaterThanOrEqual(0);
    }
  });

  it('formate la date en heure de Paris, sans fuseau', () => {
    expect(engine.readingAt('000004', slot.toUTC()).date).toBe('2026-11-19T08:00:00');
  });

  it('rejoue une série de moins d\'un an en boucle', () => {
    const series = engine.seriesFor('000004');
    const a = engine.readingAt('000004', slot);
    const b = engine.readingAt('000004', slot.plus({ days: series.days.length }));
    // même référence et même personnalité : seul le bruit diffère (au plus ±2 d'écart arrondi)
    expect(Math.abs(a.temperature - b.temperature)).toBeLessThanOrEqual(3);
  });

  it('rejoue par jour de l\'année si la série couvre un an (29/02 → 28/02)', () => {
    const yearEngine = createEngine({ pool: yearPool(), zone: ZONE });
    const july = yearEngine.readingAt('000004', paris('2026-07-14T08:00'));
    expect(Math.abs(july.temperature - 70)).toBeLessThanOrEqual(2);
    const leap = yearEngine.readingAt('000004', paris('2028-02-29T08:00'));
    expect(Math.abs(leap.temperature - 25)).toBeLessThanOrEqual(2);
  });
});

describe('disponibilité des relevés', () => {
  const hive = hiveCreatedAt('000004', '2026-11-19T15:00');
  const now = paris('2026-11-19T15:00');

  it('fournit 30 jours d\'historique à la création, sans créneau futur', () => {
    const readings = engine.readingsFor(hive, { now });
    expect(readings).toHaveLength(61); // 30 jours × 2 + le 19/11 à 08:00
    expect(readings[0].date).toBe('2026-10-20T08:00:00');
    expect(readings.at(-1).date).toBe('2026-11-19T08:00:00');
    expect(readings.map((r) => r.date)).toContain('2026-10-25T20:00:00'); // jour du changement d'heure
  });

  it('un créneau n\'apparaît qu\'une fois son heure passée', () => {
    expect(engine.readingsFor(hive, { now: paris('2026-11-19T19:59:59') }).at(-1).date).toBe('2026-11-19T08:00:00');
    expect(engine.readingsFor(hive, { now: paris('2026-11-19T20:00') }).at(-1).date).toBe('2026-11-19T20:00:00');
  });

  it('ne remonte jamais avant history_start', () => {
    const readings = engine.readingsFor(hive, { now, from: paris('2020-01-01T00:00') });
    expect(readings[0].date).toBe('2026-10-20T08:00:00');
  });

  it('applique from / to et after (strictement après)', () => {
    const ranged = engine.readingsFor(hive, { now, from: paris('2026-11-01T08:00'), to: paris('2026-11-02T08:00') });
    expect(ranged.map((r) => r.date)).toEqual(['2026-11-01T08:00:00', '2026-11-01T20:00:00', '2026-11-02T08:00:00']);

    const after = engine.readingsFor(hive, { now, after: paris('2026-11-18T08:00') });
    expect(after.map((r) => r.date)).toEqual(['2026-11-18T20:00:00', '2026-11-19T08:00:00']);
  });

  it('les relevés communs à deux appels sont identiques (pas de courbe qui saute)', () => {
    const early = engine.readingsFor(hive, { now });
    const later = engine.readingsFor(hive, { now: paris('2026-11-25T21:00') });
    expect(later.slice(0, early.length)).toEqual(early);
  });
});
