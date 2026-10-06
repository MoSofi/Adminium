// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test ledger installed through the add-on routes, beside tables of the
 * owner's own that each carry a posting rule — and a write service wired the
 * way the server wires one: the kept installs, the add-on's real deciding
 * file, the store's own version.
 *
 * A test that writes through a posting table mocks `refuseUnbuiltTable`
 * itself (a mock is the test file's to declare).
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { expect } from 'vitest';

import { loadDecider, type InstalledDecider } from '../src/add-ons/decide.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import type { PostedOutcome } from '../src/crud/ledger-write.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService, type RecordWriteService, type WriteServiceOptions } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { createLedgerRuntime, type LedgerRuntime, type LedgerRuntimeDeps } from '../src/ledgers/registry.js';
import { addOnHarness, type Dialect, type Harness } from './app-add-ons.helpers.js';
import { LEDGER_KIT_SERVER, ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';

export const DESK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
/** A guest, as the public API names one: a browser key, nobody's name. */
export const GUEST: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key_1' }, request: null };

export interface LedgerWorld {
  h: Harness;
  dialect: Dialect;
  writes: RecordWriteService;
  /** A write service over the same stores with another add-on runtime (code not loaded, another version) or other options. */
  service(runtime?: Partial<LedgerRuntimeDeps> | null, more?: Partial<WriteServiceOptions>): RecordWriteService;
  runtime: LedgerRuntime;
  decider: InstalledDecider;
  target(name: string): WriteTarget;
  /** What the last save through `create` or `update` handed its door. */
  posted(): PostedOutcome[];
  create(name: string, values: Record<string, unknown>, context?: WriteContext, service?: RecordWriteService): Promise<Record<string, unknown>>;
  update(name: string, id: unknown, values: Record<string, unknown>, context?: WriteContext, service?: RecordWriteService): Promise<unknown>;
  count(table: string, where?: string): Promise<number>;
  /** A yes/no as each engine's SQL spells it. */
  flag(on: boolean): string;
  /** A name quoted as the engine quotes one. */
  q(name: string): string;
  /** `phase:round:state:rows` of each receipt of a source row under one rule, oldest first. */
  receiptsOf(posting: string, id: unknown): Promise<string[]>;
  misbehave(how: string | null): Promise<unknown>;
  close(): Promise<void>;
}

/** The refusal a save met; fails when it went through. */
export async function refusal(run: Promise<unknown>): Promise<{ code?: string; details?: Record<string, unknown>; statusCode?: number } & Error> {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown>; statusCode?: number } & Error;
  }
  throw new Error('the save went through');
}

/**
 * `tables`: the owner's own tables, each `columns` in SQL after an `id` key,
 * with the posting rules stored on it.
 */
export async function ledgerWorld(dialect: Dialect, tables: Record<string, { columns: string; postings: readonly unknown[] }>, manifest: Record<string, unknown> = ledgerKitManifest()): Promise<LedgerWorld> {
  const h = await addOnHarness(dialect, { unbuiltWords: {} });
  await h.stageAddOn(manifest, { files: ledgerKitFiles(manifest) });
  const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
  expect(added.statusCode, added.body).toBe(200);
  const serial = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : dialect === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  for (const [name, table] of Object.entries(tables)) await h.rows(`CREATE TABLE ${name} (id ${serial}, ${table.columns})`);
  await h.introspect();
  const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
  const idOf = (name: string) => model.tables.find((table) => table.name === name)!.id;
  for (const [name, table] of Object.entries(tables)) {
    if (table.postings.length > 0) await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.postings', tableName: idOf(name), columnName: null, value: { postings: table.postings }, origin: 'user' } as never);
  }
  const view = new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
  const { db, dialect: engine } = await h.manager.data(h.connectionId);
  const target = (name: string): WriteTarget => ({ connectionId: h.connectionId, view, table: view.table(idOf(name)), db, dialect: engine, timezone: 'Europe/London' });
  const installs = keepAddOnInstalls(h.meta, async () => model);
  const decider = loadDecider({ key: 'ledger-kit', version: '1.0.0', path: 'dist/server.js', bytes: LEDGER_KIT_SERVER });
  const deps: LedgerRuntimeDeps = {
    installs: () => installs.current(),
    refresh: () => installs.fresh(),
    decider: (key) => (key === 'ledger-kit' ? decider : null),
    versionNow: async (key) => {
      const row = await h.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
      return row === undefined ? null : { version: row.version, status: row.status };
    },
  };
  const runtime = createLedgerRuntime(deps);
  const service: LedgerWorld['service'] = (over, more = {}) => createWriteService({ ...writeStores(h.meta), ...(over === null ? {} : { ledgers: over === undefined ? runtime : createLedgerRuntime({ ...deps, ...over }) }), ...more });
  const writes = service();
  let posted: PostedOutcome[] = [];
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  return {
    h,
    dialect,
    writes,
    service,
    runtime,
    decider,
    target,
    posted: () => posted,
    create(name, values, context = DESK, using = writes) {
      const at = target(name);
      posted = [];
      return using.create({
        target: at,
        values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(at.table.columns.get(k)!, v)])),
        context,
        announce: async (_row, _values, outcomes) => {
          posted = [...(outcomes ?? [])];
        },
      });
    },
    update(name, id, values, context = DESK, using = writes) {
      posted = [];
      return using.update({
        target: target(name),
        pk: { id },
        values,
        context,
        announce: async (outcome) => {
          posted = [...(outcome.postings ?? [])];
        },
      });
    },
    count: async (table, where = '1 = 1') => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']),
    flag: (on) => (dialect === 'postgres' ? String(on) : on ? '1' : '0'),
    q,
    receiptsOf: async (posting, id) =>
      (await h.rows(`SELECT phase, round, state, ${q('rows')} AS n FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = '${posting}' ORDER BY id`)).map(
        (row) => `${String(row['phase'])}:${String(row['round'])}:${String(row['state'])}:${String(row['n'])}`,
      ),
    misbehave: (how) => h.rows(`UPDATE ledger_kit_settings SET misbehave = ${how === null ? 'NULL' : `'${how}'`}`),
    close: () => h.close(),
  };
}
