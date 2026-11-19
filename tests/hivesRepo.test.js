import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { createHivesRepo, HiveExistsError, HiveLimitError } from '../src/db/hivesRepo.js';

const hive = (serial, extra = {}) => ({
  serial,
  latitude: 48.85,
  longitude: 2.35,
  created_at: '2026-11-19T15:00:00+01:00',
  history_start: '2026-10-20T00:00:00+02:00',
  ...extra,
});

describe('hivesRepo', () => {
  let db;
  let repo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = createHivesRepo(db);
  });

  it('crée puis relit une ruche', () => {
    const created = repo.create(hive('000004'));
    expect(created).toEqual(hive('000004'));
    expect(repo.get('000004')).toEqual(hive('000004'));
  });

  it('renvoie null pour une ruche inconnue', () => {
    expect(repo.get('999999')).toBeNull();
  });

  it('liste les ruches triées par numéro', () => {
    repo.create(hive('000010'));
    repo.create(hive('000002'));
    expect(repo.list().map((h) => h.serial)).toEqual(['000002', '000010']);
    expect(repo.count()).toBe(2);
  });

  it('refuse un numéro déjà enregistré', () => {
    repo.create(hive('000004'));
    expect(() => repo.create(hive('000004'))).toThrow(HiveExistsError);
  });

  it('applique le plafond de ruches', () => {
    repo.create(hive('000001'), { maxHives: 2 });
    repo.create(hive('000002'), { maxHives: 2 });
    expect(() => repo.create(hive('000003'), { maxHives: 2 })).toThrow(HiveLimitError);
    expect(repo.count()).toBe(2);
  });

  it('supprime une ruche', () => {
    repo.create(hive('000004'));
    expect(repo.remove('000004')).toBe(true);
    expect(repo.remove('000004')).toBe(false);
    expect(repo.get('000004')).toBeNull();
  });

  it('la base refuse un numéro qui n\'a pas 6 chiffres (défense en profondeur)', () => {
    expect(() => repo.create(hive('12a456'))).toThrow();
    expect(() => repo.create(hive('1234567'))).toThrow();
  });

  it('les requêtes préparées neutralisent une injection SQL', () => {
    repo.create(hive('000004'));
    expect(repo.get("' OR '1'='1")).toBeNull();
    expect(repo.remove("' OR '1'='1")).toBe(false);
    expect(repo.count()).toBe(1);
  });
});
