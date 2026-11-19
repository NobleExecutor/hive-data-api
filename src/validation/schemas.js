import { DateTime } from 'luxon';
import { z } from 'zod';
import { ApiError } from '../middleware/errors.js';

export const MAX_SERIALS_PER_REQUEST = 50;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lit une date ISO. Sans fuseau, elle est interprétée en heure de Paris.
 * Avec `endOfDay`, une date seule (AAAA-MM-JJ) désigne la fin de cette journée.
 */
export function parseIsoDate(value, zone, { endOfDay = false } = {}) {
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid) return null;
  return endOfDay && DATE_ONLY.test(value) ? dt.endOf('day') : dt;
}

export const serialSchema = z.string().regex(/^\d{6}$/, 'doit contenir exactement 6 chiffres');

const isoDateSchema = z
  .string()
  .max(40)
  .refine((v) => DateTime.fromISO(v).isValid, 'doit être une date ISO 8601 valide');

export const createHiveSchema = z.strictObject({
  serial: serialSchema,
  gps: z.tuple([
    z.number().min(-90, 'latitude hors de [-90, 90]').max(90, 'latitude hors de [-90, 90]'),
    z.number().min(-180, 'longitude hors de [-180, 180]').max(180, 'longitude hors de [-180, 180]'),
  ]),
});

export const hiveReadingsQuerySchema = z.strictObject({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const syncReadingsQuerySchema = z.strictObject({
  serials: z
    .string()
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(
      z
        .array(serialSchema)
        .min(1, 'au moins un numéro de ruche est requis')
        .max(MAX_SERIALS_PER_REQUEST, `${MAX_SERIALS_PER_REQUEST} ruches maximum par requête`),
    ),
  since: isoDateSchema.optional(),
});

// Problèmes de structure (champ manquant, mauvais type, champ inconnu) → 400 ; valeurs → 422.
const STRUCTURAL_ISSUES = new Set(['invalid_type', 'unrecognized_keys']);

function describeIssue(issue) {
  const field = issue.path.length ? issue.path.join('.') : 'corps';
  if (issue.code === 'unrecognized_keys') return `champ(s) inconnu(s) : ${issue.keys.join(', ')}`;
  if (issue.code === 'invalid_type') return `« ${field} » est manquant ou de mauvais type`;
  if (issue.code === 'too_big' || issue.code === 'too_small') {
    if (issue.origin === 'array' && field === 'gps') return '« gps » doit être [latitude, longitude]';
  }
  return `« ${field} » ${issue.message}`;
}

/** Valide `data` avec `schema` ; lève une ApiError 400 ou 422 sinon. */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  if (STRUCTURAL_ISSUES.has(issue.code)) {
    throw new ApiError(400, 'bad_request', `Requête mal formée : ${describeIssue(issue)}.`);
  }
  throw new ApiError(422, 'validation_error', `Valeur invalide : ${describeIssue(issue)}.`);
}

export function validateSerial(serial) {
  return validate(z.object({ serial: serialSchema }), { serial }).serial;
}
