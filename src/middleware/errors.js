/** Erreur métier renvoyée au client sous la forme { error: { code, message } }. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function errorBody(code, message) {
  return { error: { code, message } };
}

export function notFoundHandler(req, res) {
  res.status(404).json(errorBody('not_found', 'Route inconnue.'));
}

/**
 * Gestionnaire d'erreurs final : aucune trace interne n'est renvoyée au client.
 * Les erreurs inattendues sont loggées sans le corps de la requête (qui peut contenir un GPS).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json(errorBody(err.code, err.message));
  }
  // Erreurs levées par express.json()
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json(errorBody('invalid_json', 'Le corps de la requête n\'est pas un JSON valide.'));
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json(errorBody('payload_too_large', 'Corps de requête trop volumineux (10 Ko maximum).'));
  }
  if (err?.status >= 400 && err.status < 500) {
    return res.status(400).json(errorBody('bad_request', 'Requête mal formée.'));
  }

  console.error(`[error] ${req.method} ${req.originalUrl.split('?')[0]} :`, err?.stack ?? err);
  return res.status(500).json(errorBody('internal_error', 'Erreur interne du serveur.'));
}
