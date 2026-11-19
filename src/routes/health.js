import { Router } from 'express';

/** Seule route publique : ne renvoie aucune information interne. */
export function createHealthRouter() {
  const router = Router();
  router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
