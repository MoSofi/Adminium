// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved apps, what an install still needs, workspace files and their
 * installs, and the workspaces repo's edges: missing rows answer null or
 * false, never throw; ticks and order survive.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AppVersionSaved,
  WorkspaceNameTaken,
  appAfterInstallRepo,
  appSavesRepo,
  appTablesRepo,
  connectionsRepo,
  firstRun,
  manifestsRepo,
  workspaceInstallsRepo,
  workspaceSavesRepo,
  workspacesRepo,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const T0 = 1_750_000_000_000;

async function connection(meta: MetaDb, name = 'Cafe'): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name, engine: 'postgres', introspectDsn: `postgres://ro@x/${name.toLowerCase()}` })).id;
}

const SAVE = { lineage: 'lin_1', label: 'Shop 1.0.0', savedBy: null, integrity: 'sha256-x', bytes: 10 };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`saved apps and workspaces [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('saves a version once, lists by database and key, and reads what it carried', async () => {
      const kiln = await connection(t.meta, 'Kiln');
      const repo = appSavesRepo(t.meta);
      const carried = { rows: { orders: ['id', 'total'] }, personal: [], files: false, instance: true };
      const one = await repo.create({ ...SAVE, appKey: 'shop', version: '1.0.0', connectionId: kiln, carried }, T0);
      await repo.create({ ...SAVE, appKey: 'shop', version: '1.0.1', connectionId: null }, T0 + 1);
      await expect(repo.create({ ...SAVE, appKey: 'shop', version: '1.0.0', connectionId: kiln })).rejects.toBeInstanceOf(AppVersionSaved);

      expect((await repo.findById(one.id))?.carried).toEqual(carried);
      expect(await repo.findById('asv_missing')).toBeNull();
      expect((await repo.list()).map((save) => save.version)).toEqual(['1.0.1', '1.0.0']);
      expect((await repo.list({ connectionId: kiln })).map((save) => save.version)).toEqual(['1.0.0']);
      const forKey = await repo.listForKey('shop');
      expect(forKey[1]?.carried).toEqual(carried);
      expect(forKey[0]?.carried).toBeNull();
    });

    it('keeps a tick through an update, unticks, hides the list and drops what a file no longer names', async () => {
      const kiln = await connection(t.meta);
      const install = await manifestsRepo(t.meta, crypto).install({ manifestKey: 'shop', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: kiln, scopeKey: kiln });
      const manifestId = install.row.id;
      const repo = appAfterInstallRepo(t.meta);
      const items = [
        { kind: 'secret', item: 'stripe', field: 'key' },
        { kind: 'webhook', item: 'orders', field: 'url' },
      ];
      const [first] = await repo.put({ manifestId, appKey: 'shop' }, items, T0);
      expect(await repo.setDone(manifestId, first!.id, true, null, T0 + 5)).toBe(true);
      expect(await repo.setDone('other', first!.id, true, null)).toBe(false);
      // An update naming the same items keeps the tick.
      await repo.put({ manifestId, appKey: 'shop' }, items, T0 + 10);
      expect(await repo.findById(manifestId, first!.id)).toMatchObject({ done: true, doneBy: null, doneAt: T0 + 5 });
      await repo.setDone(manifestId, first!.id, false, null);
      expect(await repo.findById(manifestId, first!.id)).toMatchObject({ done: false, doneBy: null, doneAt: null });
      expect(await repo.findById(manifestId, 'aai_missing')).toBeNull();

      expect(await repo.hiddenAt(manifestId)).toBeNull();
      await repo.setHidden(manifestId, true, null, T0 + 20);
      expect(await repo.hiddenAt(manifestId)).toBe(T0 + 20);
      await repo.setHidden(manifestId, false, null);
      expect(await repo.hiddenAt(manifestId)).toBeNull();

      expect(await repo.remove(manifestId, items)).toBe(0);
      expect(await repo.remove(manifestId, [items[1]!])).toBe(1);
      expect((await repo.list(manifestId)).map((item) => item.kind)).toEqual(['webhook']);
    });

    it('keeps workspace files newest first, and an install row through its run lock', async () => {
      const saves = workspaceSavesRepo(t.meta);
      const a = await saves.create({ workspaceId: null, name: 'Studio', label: 'Studio 1', savedBy: null, integrity: 'sha256-a', bytes: 3, appSaveIds: ['asv_1'], document: '{}' }, T0);
      await saves.create({ workspaceId: null, name: 'Studio', label: 'Studio 2', savedBy: null, integrity: 'sha256-b', bytes: 4, appSaveIds: [], document: '{}' }, T0 + 1);
      expect((await saves.findById(a.id))?.appSaveIds).toEqual(['asv_1']);
      expect(await saves.findById('wss_missing')).toBeNull();
      expect((await saves.list()).map((save) => save.label)).toEqual(['Studio 2', 'Studio 1']);

      const installs = workspaceInstallsRepo(t.meta);
      const app = { key: 'shop', version: '1.0.0', integrity: 'sha256-c', target: null, state: 'pending' as const };
      const row = await installs.create({ integrity: 'sha256-w', staged: 'stg_1', name: 'Studio', apps: [app], createdBy: null }, T0);
      expect(row).toMatchObject({ state: 'staged', document: null, workspaceChoice: null });
      expect(await installs.findById('wsi_missing')).toBeNull();

      await installs.update(row.id, { workspaceChoice: { mode: 'create', name: 'Studio' } }, T0 + 1);
      expect((await installs.findById(row.id))?.workspaceChoice).toEqual({ mode: 'create', name: 'Studio' });
      await installs.update(row.id, { apps: [{ ...app, state: 'installed' }], workspaceChoice: null, state: 'running' }, T0 + 2);
      const running = await installs.findById(row.id);
      expect(running).toMatchObject({ state: 'running', workspaceChoice: null });
      expect(running?.apps[0]?.state).toBe('installed');
      await installs.update(row.id, {}, T0 + 3);
      expect((await installs.findById(row.id))?.updatedAt).toBe(T0 + 3);

      expect(await installs.lock(row.id, 'run_a', T0)).toBe(true);
      expect(await installs.lock(row.id, 'run_b', T0 + 1)).toBe(false);
      expect(await installs.refresh(row.id, 'run_b', T0 + 2)).toBe(false);
      expect(await installs.refresh(row.id, 'run_a', T0 + 2)).toBe(true);
      // A stale lock is taken over.
      expect(await installs.lock(row.id, 'run_b', T0 + 2 + 16 * 60_000)).toBe(true);
      await installs.unlock(row.id, 'run_a');
      expect((await installs.findById(row.id))?.runLock).toBe('run_b');
      await installs.unlock(row.id, 'run_b');
      expect((await installs.findById(row.id))?.runLock).toBeNull();

      await installs.update(row.id, { state: 'done' });
      expect(await installs.listOpen()).toEqual([]);
    });

    it('answers null or false for a workspace that is not there, and refuses a taken name on rename', async () => {
      const repo = workspacesRepo(t.meta);
      const kiln = await connection(t.meta, 'Kiln');
      expect(await repo.count()).toBe(0);
      const studio = await repo.create({ name: 'Studio', connectionIds: [kiln, kiln] }, T0);
      const shop = await repo.create({ name: 'Shop' }, T0 + 1);
      expect(studio.connectionIds).toEqual([kiln]);
      expect(shop.position).toBe(studio.position + 1);
      expect(await repo.count()).toBe(2);

      await expect(repo.rename(shop.id, 'Studio')).rejects.toBeInstanceOf(WorkspaceNameTaken);
      // Renaming a workspace to its own name is not a clash with itself.
      expect((await repo.rename(studio.id, 'Studio', T0 + 2))?.name).toBe('Studio');
      expect(await repo.rename('wsp_missing', 'Other')).toBeNull();
      expect(await repo.findById('wsp_missing')).toBeNull();
      expect(await repo.setSender('wsp_missing', { name: 'A', from: 'a@example.com', replyTo: null, postal: null })).toBeNull();
      expect(await repo.remove('wsp_missing')).toBe(false);
      expect(await repo.shownIn('email-template', 'tpl_missing')).toBeNull();
      expect(await repo.setShownIn('email-template', 'tpl_missing', null)).toBe(false);
      expect(await repo.existing([])).toEqual([]);

      // Moving a database: one link added, one removed; the same set again is no change.
      expect(await repo.setForConnection(kiln, [shop.id], T0 + 3)).toEqual({ added: [shop.id], removed: [studio.id] });
      expect(await repo.setForConnection(kiln, [shop.id], T0 + 4)).toEqual({ added: [], removed: [] });
      expect(await repo.forConnection(kiln)).toEqual([shop.id]);
      await expect(repo.setForConnection(kiln, ['wsp_missing'])).rejects.toThrow(/unknown workspaces/);
      expect(await repo.reorder([shop.id])).toBe(false);
      expect(await repo.reorder([shop.id, shop.id])).toBe(false);
      expect(await repo.reorder([shop.id, studio.id])).toBe(true);
      expect((await repo.list()).map((one) => one.id)).toEqual([shop.id, studio.id]);
    });

    it('reads app-table rules written by a later version without crashing, and finds a table in a schema', async () => {
      const connectionId = await connection(t.meta);
      const repo = appTablesRepo(t.meta);
      const record = await repo.record({ appKey: 'shop', manifestId: null, connectionId, ref: 'orders', tableName: 'orders', schemaName: 'shop', owned: true, state: 'created', shapeColumns: ['id'], module: 'sales' });
      await repo.record({ appKey: 'other', manifestId: null, connectionId, ref: 'orders', tableName: 'orders', owned: false, state: 'adopted' });
      expect((await repo.byTable(connectionId, 'shop.orders')).map((one) => one.appKey)).toEqual(['shop']);
      expect((await repo.byTable(connectionId, 'orders')).map((one) => one.appKey)).toEqual(['other']);

      // Bad entries are skipped; a good one keeps its optional fields.
      const rules = JSON.stringify([
        null,
        'x',
        { op: 'unique', table: 'orders' },
        { op: 'unique', table: 'orders', valueHash: 'h' },
        { op: 'unique', table: 'orders', valueHash: 'h', overrideId: 'ovr_1', column: 'code', released: true, shape: 's', handedFrom: 'pos' },
        { op: 'check', table: 'orders', valueHash: 'h2', overrideId: 'ovr_2', column: 3 },
      ]);
      await t.meta.db.updateTable('adminium_app_tables').set({ rules }).where('id', '=', record.id).execute();
      const read = await repo.find(connectionId, 'shop', 'orders');
      expect(read?.rules).toEqual([
        { op: 'unique', table: 'orders', column: 'code', valueHash: 'h', overrideId: 'ovr_1', released: true, shape: 's', handedFrom: 'pos' },
        { op: 'check', table: 'orders', column: null, valueHash: 'h2', overrideId: 'ovr_2' },
      ]);
      await t.meta.db.updateTable('adminium_app_tables').set({ rules: '{"not":"a list"}', state: 'later' }).where('id', '=', record.id).execute();
      const odd = await repo.find(connectionId, 'shop', 'orders');
      expect(odd?.rules).toEqual([]);
      expect(odd?.state).toBe('adopted');

      // Found again: the schema, shape and module stay when left out, and clear when given null.
      const kept = await repo.record({ appKey: 'shop', manifestId: null, connectionId, ref: 'orders', tableName: 'orders', owned: false, state: 'adopted' });
      expect(kept).toMatchObject({ schemaName: 'shop', owned: true, state: 'created' });
      const cleared = await repo.record({ appKey: 'shop', manifestId: null, connectionId, ref: 'orders', tableName: 'orders', schemaName: null, owned: true, state: 'created', shape: null, shapeColumns: null, builtOn: '0.1.0', module: null });
      expect(cleared).toMatchObject({ schemaName: null, shape: null });
    });
  });
}
