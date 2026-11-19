import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import {
  hiveReadingsQuerySchema,
  parseIsoDate,
  syncReadingsQuerySchema,
  validate,
  validateSerial,
} from '../validation/schemas.js';

export function createReadingsRouter({ repo, engine, clock, zone }) {
  const router = Router();

  // Relevés d'une ruche, bornés à [history_start, maintenant].
  router.get('/hives/:serial/readings', (req, res) => {
    const serial = validateSerial(req.params.serial);
    const query = validate(hiveReadingsQuerySchema, req.query);
    const from = query.from ? parseIsoDate(query.from, zone) : null;
    const to = query.to ? parseIsoDate(query.to, zone, { endOfDay: true }) : null;
    if (from && to && from > to) {
      throw new ApiError(422, 'validation_error', 'Valeur invalide : « from » doit précéder « to ».');
    }

    const hive = repo.get(serial);
    if (!hive) throw new ApiError(404, 'hive_not_found', `Ruche inconnue : ${serial}.`);

    const data = engine.readingsFor(hive, { now: clock(), from, to });
    res.json({ [serial]: { gps: [hive.latitude, hive.longitude], data } });
  });

  // Synchro : relevés de plusieurs ruches strictement après `since` (ou depuis history_start).
  router.get('/readings', (req, res) => {
    const query = validate(syncReadingsQuerySchema, req.query);
    const after = query.since ? parseIsoDate(query.since, zone) : null;

    const hives = query.serials.map((serial) => repo.get(serial) ?? serial);
    const unknown = hives.filter((h) => typeof h === 'string');
    if (unknown.length > 0) {
      throw new ApiError(404, 'hive_not_found', `Ruche(s) inconnue(s) : ${unknown.join(', ')}.`);
    }

    const now = clock();
    const result = {};
    for (const hive of hives) {
      result[hive.serial] = {
        gps: [hive.latitude, hive.longitude],
        data: engine.readingsFor(hive, { now, after }),
      };
    }
    res.json(result);
  });

  return router;
}
