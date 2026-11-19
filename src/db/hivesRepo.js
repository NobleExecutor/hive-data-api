export class HiveExistsError extends Error {
  constructor(serial) {
    super(`La ruche ${serial} existe déjà.`);
    this.name = 'HiveExistsError';
  }
}

export class HiveLimitError extends Error {
  constructor(maxHives) {
    super(`Nombre maximal de ruches atteint (${maxHives}).`);
    this.name = 'HiveLimitError';
  }
}

/** Accès à la table hives, uniquement par requêtes préparées. */
export function createHivesRepo(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO hives (serial, latitude, longitude, created_at, history_start)
      VALUES (@serial, @latitude, @longitude, @created_at, @history_start)
    `),
    get: db.prepare('SELECT * FROM hives WHERE serial = ?'),
    list: db.prepare('SELECT * FROM hives ORDER BY serial'),
    remove: db.prepare('DELETE FROM hives WHERE serial = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM hives'),
  };

  // Transaction : la vérification du plafond et l'insertion sont atomiques.
  const insertWithChecks = db.transaction((hive, maxHives) => {
    if (stmts.get.get(hive.serial)) throw new HiveExistsError(hive.serial);
    if (stmts.count.get().n >= maxHives) throw new HiveLimitError(maxHives);
    stmts.insert.run(hive);
  });

  return {
    /**
     * @param {{serial, latitude, longitude, created_at, history_start}} hive
     * @param {{maxHives?: number}} options
     */
    create(hive, { maxHives = Infinity } = {}) {
      insertWithChecks(hive, maxHives);
      return stmts.get.get(hive.serial);
    },
    get(serial) {
      return stmts.get.get(serial) ?? null;
    },
    list() {
      return stmts.list.all();
    },
    /** @returns {boolean} true si une ruche a été supprimée */
    remove(serial) {
      return stmts.remove.run(serial).changes > 0;
    },
    count() {
      return stmts.count.get().n;
    },
  };
}
