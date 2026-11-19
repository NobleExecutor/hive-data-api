import fs from 'node:fs';
import { DateTime } from 'luxon';
import { z } from 'zod';

export class SeriesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeriesError';
  }
}

export const FIELDS = Object.freeze(['temperature', 'poids', 'humidite', 'frequence']);

/** Nombre de jours à partir duquel une série est rejouée par jour de l'année. */
export const FULL_YEAR_DAYS = 365;

const readingSchema = z.object({
  date: z.string(),
  temperature: z.number(),
  poids: z.number(),
  humidite: z.number(),
  frequence: z.number(),
});

// Le champ gps du fichier est volontairement ignoré : le GPS d'une ruche vient du POST /hives.
const poolSchema = z.record(
  z.string(),
  z.object({ gps: z.unknown().optional(), data: z.array(readingSchema).min(1) }),
);

const pickValues = (entry) => Object.fromEntries(FIELDS.map((f) => [f, entry[f]]));

/**
 * Transforme les relevés bruts d'une série en une suite continue de jours,
 * chacun avec ses deux créneaux (08 et 20). Un créneau manquant reprend le relevé précédent.
 */
function normalizeSeries(id, entries) {
  const byDay = new Map();

  entries.forEach((entry, index) => {
    // Dates sans fuseau = heure locale : on ne lit que les champs calendaires.
    const dt = DateTime.fromISO(entry.date, { zone: 'UTC', setZone: true });
    if (!dt.isValid) {
      throw new SeriesError(`Série ${id} : date invalide à l'index ${index}.`);
    }
    const dayKey = dt.toISODate();
    const slot = dt.hour < 14 ? 8 : 20;
    const day = byDay.get(dayKey) ?? {};
    day[slot] ??= pickValues(entry);
    byDay.set(dayKey, day);
  });

  const dayKeys = [...byDay.keys()].sort();
  const lastDay = DateTime.fromISO(dayKeys.at(-1), { zone: 'UTC' });
  const first = byDay.get(dayKeys[0]);
  let previous = first[8] ?? first[20];

  const days = [];
  for (let cursor = DateTime.fromISO(dayKeys[0], { zone: 'UTC' }); cursor <= lastDay; cursor = cursor.plus({ days: 1 })) {
    const day = byDay.get(cursor.toISODate()) ?? {};
    const morning = day[8] ?? previous;
    const evening = day[20] ?? morning;
    previous = evening;
    days.push({ monthDay: cursor.toFormat('MM-dd'), slots: { 8: morning, 20: evening } });
  }

  let byMonthDay = null;
  if (days.length >= FULL_YEAR_DAYS) {
    byMonthDay = new Map();
    days.forEach((day, index) => {
      if (!byMonthDay.has(day.monthDay)) byMonthDay.set(day.monthDay, index);
    });
  }

  return Object.freeze({ id, days, byMonthDay });
}

/** Construit le pool de séries à partir d'un objet JSON (même format que le fichier). */
export function buildPool(json) {
  const parsed = poolSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? issue.path.join('.') : '(racine)';
    throw new SeriesError(`Fichier de séries invalide : ${where} – ${issue.message}`);
  }

  const ids = Object.keys(parsed.data).sort();
  if (ids.length === 0) {
    throw new SeriesError('Fichier de séries invalide : aucune série.');
  }

  return Object.freeze({
    ids,
    series: ids.map((id) => normalizeSeries(id, parsed.data[id].data)),
  });
}

/** Charge le pool depuis un fichier JSON. Lève une SeriesError avec un message clair. */
export function loadSeriesFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new SeriesError(`Fichier de séries introuvable ou illisible : ${filePath}`);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SeriesError(`Fichier de séries invalide (JSON mal formé) : ${filePath}`);
  }

  return buildPool(json);
}
