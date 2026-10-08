// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK INTO AN ADD-ON'S TABLE, FILLED FROM THE SETTINGS ROW — the shelf a
 * ward's supplies leave is chosen once, in its settings, and every line
 * nobody chose a shelf for takes it.
 *
 * Nobody typed that value in the save that uses it, so it never refuses one:
 * while the add-on is not there for the app, and when the row the setting
 * names has gone, the link is left empty, as it would be with no setting. A
 * value a person sends is judged as it always was. And what the line posts is
 * taken from the row the default named.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDecider } from '../src/add-ons/decide.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEDGER_KIT_SERVER, ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const DESK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
const KIT = 'ledger-kit';
const account = { addOnLink: { addOn: KIT, table: 'accounts' } };

/** A ward: its settings name the account supplies are taken from, and a supply nobody chose one for takes it. */
const WARD: Doc = {
  kind: 'app',
  manifestVersion: 1,
  key: 'ward',
  name: 'Ward',
  version: '0.3.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A ward.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.19' },
  pages: [{ ref: 'ward-supplies', template: 'page-crud', title: { key: 't', fallback: 'Supplies' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'supplies' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: {
    suggests: [{ key: KIT, range: '>=1.0.0', reason: { 'en-US': 'Keeps units.' } }],
    features: [{ id: 'units', label: { 'en-US': 'Units' }, requires: [KIT] }],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'account_id', type: 'int', nullable: true, rules: account }] },
      {
        ref: 'supplies',
        states: { column: 'status', initial: 'noted', moves: { noted: ['used'], used: ['noted'] } },
        postings: [
          {
            id: 'supply',
            into: { addOn: KIT, ledger: 'units', action: 'use' },
            needs: 'units',
            post: { on: { to: ['used'] } },
            reverse: { on: { to: ['noted'], from: ['used'] } },
            map: { account: 'account_id', quantity: 'qty' },
          },
        ],
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'status', type: 'enum', enum: ['noted', 'used'], default: 'noted' },
          { ref: 'account_id', type: 'int', nullable: true, rules: { ...account, default: { from: { table: 'settings', column: 'account_id' } } } },
          { ref: 'qty', type: 'decimal', scale: 3, default: 1 },
        ],
      },
    ],
  },
};

const refusal = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; statusCode?: number; details?: Record<string, unknown> };
  }
  throw new Error('the save went through');
};

describe.each(LEGS)('a link into an add-on filled from the settings row — %s', (dialect, available) => {
  let h: Harness;
  const target = async (table: string): Promise<WriteTarget> => {
    const view = await loadSnapshotView(h.meta, h.connectionId, { lists: true });
    const { db, dialect: engine } = await h.manager.data(h.connectionId);
    return { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((candidate) => candidate.name === table)!.id), db, dialect: engine, timezone: 'UTC' };
  };
  /** A write service wired as the server wires one: the kept installs and the add-on's own deciding file. */
  const writes = () => {
    const installs = keepAddOnInstalls(h.meta, async () => parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema));
    const decider = loadDecider({ key: KIT, version: '1.0.0', path: 'dist/server.js', bytes: LEDGER_KIT_SERVER });
    const ledgers = createLedgerRuntime({
      installs: () => installs.current(),
      refresh: () => installs.fresh(),
      decider: (key) => (key === KIT ? decider : null),
      versionNow: async (key) => {
        const row = await h.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
        return row === undefined ? null : { version: row.version, status: row.status };
      },
    });
    return createWriteService({ ...writeStores(h.meta), ledgers });
  };
  const create = async (values: Doc) => {
    const at = await target('ward_supplies');
    return writes().create({ target: at, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(at.table.columns.get(k)!, v)])), context: DESK, announce: async () => {} });
  };
  const setting = (value: number | null) => h.rows(`UPDATE ward_settings SET account_id = ${value === null ? 'NULL' : String(value)}`);
  const balance = async (id: number) => Number((await h.rows(`SELECT balance FROM ledger_kit_accounts WHERE id = ${String(id)}`))[0]!['balance']);
  const flag = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(WARD);
    const installed = await h.install('ward', '0.3.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.rows('INSERT INTO ward_settings (id) VALUES (1)');
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('with the add-on absent a setting left from before fills nothing and refuses nothing; a value a person sends is still refused', async () => {
    // The setting could only have been chosen while the add-on was there: this is what it leaves behind.
    await setting(2);
    const made = await create({ qty: '1' });
    expect(made['account_id'] ?? null).toBeNull();
    expect(await refusal(create({ qty: '1', account_id: 2 }))).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'add-on-unavailable', column: 'account_id' } });
  });

  it.skipIf(!available)('with the add-on there for the app a line nobody chose an account for takes the setting\'s; an empty setting fills nothing', async () => {
    const kit = ledgerKitManifest();
    await h.stageAddOn(kit, { files: ledgerKitFiles(kit) });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KIT, version: '1.0.0', attachTo: ['ward'] } });
    expect(added.statusCode, added.body).toBe(200);
    await h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Store room', 10, 0, 10, ${flag(false)}, 0), (2, 'Treatment room', 10, 0, 10, ${flag(false)}, 0)`);

    await setting(2);
    expect((await create({ qty: '1' }))['account_id']).toBe(2);
    // A person's choice stands, and is judged as it always was.
    expect((await create({ qty: '1', account_id: 1 }))['account_id']).toBe(1);
    expect(await refusal(create({ qty: '1', account_id: 999 }))).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422, details: { fields: { account_id: { code: 'not-found' } } } });
    await setting(null);
    expect((await create({ qty: '1' }))['account_id'] ?? null).toBeNull();
  });

  it.skipIf(!available)('a setting that names a row no longer there fills nothing, and the save goes through', async () => {
    await setting(999);
    const made = await create({ qty: '1' });
    expect(made['account_id'] ?? null).toBeNull();
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM ward_supplies WHERE account_id = 999`))[0]!['n'])).toBe(0);
  });

  it.skipIf(!available)('what the line posts is taken from the account the setting named', async () => {
    await setting(2);
    const before = { store: await balance(1), treatment: await balance(2) };
    const line = await create({ qty: '3' });
    expect(line['account_id']).toBe(2);
    await writes().update({ target: await target('ward_supplies'), pk: { id: line['id'] }, values: { status: 'used' }, context: DESK, announce: async () => {} });
    expect(await balance(2)).toBe(before.treatment - 3);
    expect(await balance(1)).toBe(before.store);
    // Taken back, it comes back to the same account.
    await writes().update({ target: await target('ward_supplies'), pk: { id: line['id'] }, values: { status: 'noted' }, context: DESK, announce: async () => {} });
    expect(await balance(2)).toBe(before.treatment);
  });

  it.skipIf(!available)('switched off for the app, the setting fills nothing again and no save is refused for it', async () => {
    await setting(2);
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${KIT}`, payload: { attachedTo: 'ward', enabled: false } });
    expect(off.statusCode, off.body).toBeLessThan(300);
    expect((await create({ qty: '1' }))['account_id'] ?? null).toBeNull();
    expect(await refusal(create({ qty: '1', account_id: 2 }))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', column: 'account_id' } });
  });
});
