import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS hives (
  serial        TEXT PRIMARY KEY
                CHECK (length(serial) = 6 AND serial NOT GLOB '*[^0-9]*'),
  latitude      REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude     REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at    TEXT NOT NULL,
  history_start TEXT NOT NULL
);
`;

export function migrate(db) {
  db.exec(MIGRATION);
}

/** Ouvre (et crée si besoin) la base SQLite, puis applique la migration. */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}
