import { DateTime } from 'luxon';

export const DEFAULT_ZONE = 'Europe/Paris';

/** Heures locales des deux relevés quotidiens. */
export const SLOT_HOURS = Object.freeze([8, 20]);

/** Format des dates de relevés : ISO local, sans fuseau (heure de Paris). */
export const SLOT_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

export function formatSlot(slot) {
  return slot.toFormat(SLOT_FORMAT);
}

/**
 * Liste les créneaux (08:00 et 20:00 locaux) compris dans [start, end], bornes incluses,
 * dans l'ordre chronologique. Les jours sont parcourus par calendrier (luxon), ce qui
 * gère les changements d'heure : 08:00 reste 08:00 heure de Paris, quel que soit l'offset UTC.
 */
export function listSlots(start, end, zone = DEFAULT_ZONE) {
  const slots = [];
  if (!start || !end || end < start) return slots;

  let day = start.setZone(zone).startOf('day');
  const lastDay = end.setZone(zone).startOf('day');

  while (day <= lastDay) {
    for (const hour of SLOT_HOURS) {
      const slot = DateTime.fromObject(
        { year: day.year, month: day.month, day: day.day, hour },
        { zone },
      );
      if (slot >= start && slot <= end) slots.push(slot);
    }
    day = day.plus({ days: 1 });
  }
  return slots;
}

/** Début de l'historique d'une ruche : created_at − historyDays jours, à 00:00 local. */
export function computeHistoryStart(createdAt, historyDays, zone = DEFAULT_ZONE) {
  return createdAt.setZone(zone).minus({ days: historyDays }).startOf('day');
}
