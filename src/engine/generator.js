import seedrandom from 'seedrandom';
import { DateTime } from 'luxon';
import { FIELDS } from './series.js';
import { DEFAULT_ZONE, formatSlot, listSlots } from './slots.js';

/** Amplitude des décalages constants propres à chaque ruche (± valeur). */
export const PERSONALITY = Object.freeze({ temperature: 1, poids: 3, humidite: 3, frequence: 15 });

/** Amplitude du bruit appliqué à chaque relevé (± valeur). */
export const NOISE = Object.freeze({ temperature: 1, poids: 0.1, humidite: 2, frequence: 10 });

/** Hash FNV-1a 32 bits : stable d'une exécution à l'autre (contrairement à Math.random). */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Tire un décalage uniforme dans [-a, a] pour chaque champ, à partir d'une graine. */
function seededOffsets(seed, amplitudes) {
  const rng = seedrandom(seed);
  return Object.fromEntries(FIELDS.map((field) => [field, (rng() * 2 - 1) * amplitudes[field]]));
}

function finalize(values) {
  return {
    temperature: Math.round(values.temperature),
    poids: Math.max(0.1, Math.round(values.poids * 10) / 10),
    humidite: Math.min(100, Math.max(0, Math.round(values.humidite))),
    frequence: Math.max(0, Math.round(values.frequence)),
  };
}

/** Numéro de jour calendaire (jours depuis le 01/01/1970) d'une date locale. */
function calendarDayNumber(slot) {
  return Math.floor(Date.UTC(slot.year, slot.month - 1, slot.day) / 86_400_000);
}

const parseStored = (iso) => DateTime.fromISO(iso, { setZone: true });

/**
 * Moteur de génération : calcule les relevés à la demande, de façon déterministe.
 * @param {{ pool: ReturnType<import('./series.js').buildPool>, zone?: string }} options
 */
export function createEngine({ pool, zone = DEFAULT_ZONE }) {
  /** Étape 1 : série source choisie par hash du numéro. */
  function seriesFor(serial) {
    return pool.series[fnv1a(serial) % pool.series.length];
  }

  /** Étape 2 : relevé de référence pour le même créneau dans la série source. */
  function referenceFor(series, slot) {
    let dayIndex;
    if (series.byMonthDay) {
      const monthDay = slot.toFormat('MM-dd') === '02-29' ? '02-28' : slot.toFormat('MM-dd');
      dayIndex = series.byMonthDay.get(monthDay);
    }
    if (dayIndex === undefined) {
      dayIndex = ((calendarDayNumber(slot) % series.days.length) + series.days.length) % series.days.length;
    }
    return series.days[dayIndex].slots[slot.hour];
  }

  /** Étapes 2 à 5 : valeur finale d'une ruche pour un créneau. */
  function readingAt(serial, slot) {
    const local = slot.setZone(zone);
    const date = formatSlot(local);
    const reference = referenceFor(seriesFor(serial), local);
    const personality = seededOffsets(serial, PERSONALITY); // étape 3 : graine = numéro
    const noise = seededOffsets(`${serial}|${date}|${local.hour}`, NOISE); // étape 4

    const values = Object.fromEntries(
      FIELDS.map((field) => [field, reference[field] + personality[field] + noise[field]]),
    );
    return { date, ...finalize(values) };
  }

  /**
   * Étape 6 : relevés disponibles d'une ruche.
   * Fenêtre = [max(history_start, from), min(now, to)], et strictement après `after` si fourni.
   * @param {{ serial: string, history_start: string }} hive
   * @param {{ now: DateTime, from?: DateTime|null, to?: DateTime|null, after?: DateTime|null }} range
   */
  function readingsFor(hive, { now, from = null, to = null, after = null }) {
    let start = parseStored(hive.history_start);
    if (from && from > start) start = from;
    if (after) {
      const justAfter = after.plus({ milliseconds: 1 });
      if (justAfter > start) start = justAfter;
    }
    const end = to && to < now ? to : now;

    return listSlots(start, end, zone).map((slot) => readingAt(hive.serial, slot));
  }

  return { seriesFor, readingAt, readingsFor };
}
