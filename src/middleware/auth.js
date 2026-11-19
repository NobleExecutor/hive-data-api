import crypto from 'node:crypto';
import { ApiError } from './errors.js';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * Vérifie l'en-tête X-API-Key.
 * Les deux valeurs sont hachées avant la comparaison : les tampons ont toujours la même
 * longueur et timingSafeEqual ne révèle ni le contenu ni la longueur de la clé.
 */
export function requireApiKey(expectedKey) {
  const expectedHash = sha256(expectedKey);

  return function apiKeyAuth(req, res, next) {
    const provided = req.get('X-API-Key');
    if (typeof provided !== 'string' || provided === '') {
      return next(new ApiError(401, 'unauthorized', 'Clé API absente.'));
    }
    if (!crypto.timingSafeEqual(sha256(provided), expectedHash)) {
      return next(new ApiError(401, 'unauthorized', 'Clé API invalide.'));
    }
    return next();
  };
}
