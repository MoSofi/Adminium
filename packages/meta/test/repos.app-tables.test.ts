// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `appTablesRepo` — the per-install table record, on every
 * available dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appTablesRepo, connectionsRepo, firstRun, manifestsRepo, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function connection(meta: MetaDb): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name: 'Cafe', engine: 'postgres', introspectDsn: 'postgres://ro@x/cafe' })).id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`appTablesRepo [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('records once per short name, and a created table stays owned when found again', async () => {
      const connectionId = await connection(t.meta);
      const repo = appTablesRepo(t.meta);
      const first = await repo.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'tickets', tableName: 'tickets', owned: true, state: 'pending' });
      await repo.setState(first.id, 'created');
      // A resumed install finds the table already there and would call it adopted.
      const again = await repo.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'tickets', tableName: 'tickets', owned: false, state: 'adopted' });
      expect(again.id).toBe(first.id);
      expect(again.owned).toBe(true);
      expect(await repo.forInstall(connectionId, 'pos')).toHaveLength(1);
    });

    it('answers real names for what exists, not what is pending or dropped', async () => {
      const connectionId = await connection(t.meta);
      const repo = appTablesRepo(t.meta);
      await repo.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'tickets', tableName: 'pos_tickets', owned: true, state: 'created' });
      await repo.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'shifts', tableName: 'pos_shifts', owned: true, state: 'pending' });
      const gone = await repo.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'refunds', tableName: 'pos_refunds', owned: true, state: 'created' });
      await repo.setState(gone.id, 'dropped');
      expect(await repo.realNames(connectionId, 'pos')).toEqual({ tickets: 'pos_tickets' });
      expect((await repo.find(connectionId, 'pos', 'refunds'))?.releasedAt).not.toBeNull();
    });

    it('survives an uninstall and re-attaches to the next install', async () => {
      const connectionId = await connection(t.meta);
      const manifests = manifestsRepo(t.meta, crypto);
      const repo = appTablesRepo(t.meta);
      const one = await manifests.install({ manifestKey: 'pos', version: '0.1.0', kind: 'app', source: 'file', document: {}, connectionId });
      await repo.record({ appKey: 'pos', manifestId: one.row.id, connectionId, ref: 'tickets', tableName: 'tickets', owned: true, state: 'created' });
      await manifests.uninstall(one.row.id);
      expect((await repo.find(connectionId, 'pos', 'tickets'))?.manifestId).toBeNull();

      const two = await manifests.install({ manifestKey: 'pos', version: '0.2.0', kind: 'app', source: 'file', document: {}, connectionId, status: 'installing' });
      expect(await repo.attach(connectionId, 'pos', two.row.id)).toBe(1);
      expect((await repo.find(connectionId, 'pos', 'tickets'))?.manifestId).toBe(two.row.id);
      expect((await manifests.findById(two.row.id))?.row.status).toBe('installing');
      await manifests.setStatus(two.row.id, 'installed');
      expect((await manifests.findById(two.row.id))?.row.status).toBe('installed');
    });

    it('keeps the rules it wrote, and ignores an entry it cannot read', async () => {
      const connectionId = await connection(t.meta);
      const repo = appTablesRepo(t.meta);
      const rec = await repo.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'ticket_items', tableName: 'ticket_items', owned: true, state: 'created' });
      const rule = { op: 'column.copy', table: 'ticket_items', column: 'unit_price', valueHash: 'h1', overrideId: 'ovr_1' };
      await repo.setRules(rec.id, [rule, { junk: true } as never]);
      expect((await repo.find(connectionId, 'pos', 'ticket_items'))?.rules).toEqual([rule]);
      expect((await repo.byTable(connectionId, 'ticket_items')).map((r) => r.appKey)).toEqual(['pos']);
    });
  });
}
