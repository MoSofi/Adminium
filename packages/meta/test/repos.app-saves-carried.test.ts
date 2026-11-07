// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a saved app carried, read back with its schema: a record that is not
 * one (a damaged value) reads as `'unknown'` and never throws, so one bad
 * row cannot take the saves list down with it.
 */
import { describe, expect, it } from 'vitest';

import { appSavesRepo, connectionsRepo, readAppSaveCarried, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_762_000_000_000;
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const FP = `sha512-${'A'.repeat(86)}==`;

async function connection(meta: MetaDb): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name: 'fernhill', engine: 'postgres', introspectDsn: 'postgres://ro@db.internal:5432/fernhill' })).id;
}

describe('readAppSaveCarried', () => {
  it('reads a record, none, and anything else as unknown', () => {
    const record = { rows: { 'public.orders': ['note'] }, personal: [], files: false, instance: true };
    expect(readAppSaveCarried(JSON.stringify(record))).toEqual(record);
    expect(readAppSaveCarried(record)).toEqual(record);
    expect(readAppSaveCarried(null)).toBeNull();
    expect(readAppSaveCarried(undefined)).toBeNull();
    expect(readAppSaveCarried('not json {')).toBe('unknown');
    expect(readAppSaveCarried('violet')).toBe('unknown');
    expect(readAppSaveCarried({ rows: 5, personal: [], files: false, instance: false })).toBe('unknown');
    expect(readAppSaveCarried({ rows: {}, personal: [], files: 'yes', instance: false })).toBe('unknown');
    expect(readAppSaveCarried({ rows: {}, personal: [] })).toBe('unknown');
    expect(readAppSaveCarried([1, 2])).toBe('unknown');
  });
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`app saves: a damaged carried record [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('lists every save, the damaged one as unknown', async () => {
      const conn = await connection(meta());
      const saves = appSavesRepo(meta());
      const good = await saves.create({ appKey: 'fernhill-ops', version: '1.0.0', lineage: 'l', connectionId: conn, label: 'Fernhill', savedBy: null, integrity: FP, bytes: 10, carried: { rows: {}, personal: [], files: false, instance: false } }, T0);
      // Valid JSON of the wrong shape: every engine stores it.
      await meta()
        .db.insertInto('adminium_app_saves')
        .values({ id: 'asv_bad_shape', appKey: 'fernhill-ops', version: '1.0.1', lineage: 'l', connectionId: conn, label: 'Fernhill', savedBy: null, savedAt: T0 + 1, integrity: FP, bytes: 10, fileId: null, carried: JSON.stringify({ rows: 'every one', files: 1 }) } as never)
        .execute();
      await meta()
        .db.insertInto('adminium_app_saves')
        .values({ id: 'asv_bad_scalar', appKey: 'fernhill-ops', version: '1.0.2', lineage: 'l', connectionId: conn, label: 'Fernhill', savedBy: null, savedAt: T0 + 2, integrity: FP, bytes: 10, fileId: null, carried: JSON.stringify('violet') } as never)
        .execute();

      const listed = await saves.list();
      expect(listed.map((save) => [save.id, save.carried])).toEqual([
        ['asv_bad_scalar', 'unknown'],
        ['asv_bad_shape', 'unknown'],
        [good.id, { rows: {}, personal: [], files: false, instance: false }],
      ]);
      expect((await saves.findById('asv_bad_shape'))?.carried).toBe('unknown');
      expect((await saves.listForKey('fernhill-ops')).length).toBe(3);
    });
  });
}
