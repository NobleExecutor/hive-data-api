import { Router } from 'express';
import { HiveExistsError, HiveLimitError } from '../db/hivesRepo.js';
import { computeHistoryStart } from '../engine/slots.js';
import { ApiError } from '../middleware/errors.js';
import { createHiveSchema, validate, validateSerial } from '../validation/schemas.js';

/** Format public d'une ruche. */
export function toApiHive(row) {
  return {
    serial: row.serial,
    gps: [row.latitude, row.longitude],
    created_at: row.created_at,
    history_start: row.history_start,
  };
}

const toIso = (dt) => dt.startOf('second').toISO({ suppressMilliseconds: true });

export function createHivesRouter({ repo, clock, zone, maxHives, historyDays, writeLimiter }) {
  const router = Router();

  router.post('/hives', writeLimiter, (req, res) => {
    const body = validate(createHiveSchema, req.body);
    const createdAt = clock().setZone(zone);

    try {
      const row = repo.create(
        {
          serial: body.serial,
          latitude: body.gps[0],
          longitude: body.gps[1],
          created_at: toIso(createdAt),
          history_start: toIso(computeHistoryStart(createdAt, historyDays, zone)),
        },
        { maxHives },
      );
      res.status(201).json(toApiHive(row));
    } catch (err) {
      if (err instanceof HiveExistsError) throw new ApiError(409, 'hive_exists', err.message);
      if (err instanceof HiveLimitError) throw new ApiError(409, 'hive_limit', err.message);
      throw err;
    }
  });

  router.get('/hives', (req, res) => {
    res.json({ hives: repo.list().map(toApiHive) });
  });

  router.get('/hives/:serial', (req, res) => {
    const serial = validateSerial(req.params.serial);
    const row = repo.get(serial);
    if (!row) throw new ApiError(404, 'hive_not_found', `Ruche inconnue : ${serial}.`);
    res.json(toApiHive(row));
  });

  router.delete('/hives/:serial', writeLimiter, (req, res) => {
    const serial = validateSerial(req.params.serial);
    if (!repo.remove(serial)) throw new ApiError(404, 'hive_not_found', `Ruche inconnue : ${serial}.`);
    res.status(204).end();
  });

  return router;
}
