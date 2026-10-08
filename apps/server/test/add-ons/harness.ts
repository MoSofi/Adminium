// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RELEASED-SHAPE ADD-ON, INSTALLED FOR REAL.
 *
 * The add-ons live in a repository of their own. A test here takes one as it
 * is built there — its `manifest.json` and the files its manifest names —
 * and installs it through the add-on routes, the way a server does with a
 * package that comes with it. So what is tested is the add-on an owner will
 * get, on each database, and not a fixture written to look like it.
 *
 * It needs a checkout of that repository with the package built
 * (`ADMINIUM_ADD_ONS_REPO`, and `npm run build` in the package). Where there
 * is none the suites are skipped, by name.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';

import { loadDecider } from '../../src/add-ons/decide.js';
import { keepAddOnInstalls } from '../../src/apps/table-ref.js';
import { applyOverrides } from '../../src/connections/effective-schema.js';
import { SnapshotView } from '../../src/crud/identifiers.js';
import type { PostedOutcome } from '../../src/crud/ledger-write.js';
import type { WriteContext, WriteTarget } from '../../src/crud/write-context.js';
import { createWriteService } from '../../src/crud/write-service.js';
import { writeStores } from '../../src/crud/write-stores.js';
import { normalizeWriteValue } from '../../src/crud/write-values.js';
import { createLedgerRuntime, type LedgerRefusal, type LedgerRuntimeDeps } from '../../src/ledgers/registry.js';
import { addOnHarness, type Dialect, type Harness, type HarnessOptions } from '../app-add-ons.helpers.js';

type Doc = Record<string, unknown>;

/** Where the add-ons repository is checked out, when it is. */
export const ADD_ONS_REPO = process.env['ADMINIUM_ADD_ONS_REPO'];

export interface BuiltAddOn {
  key: string;
  version: string;
  manifest: Doc;
  /** The built files the manifest names, by their path in the package. */
  files: Record<string, string>;
}

/** Every file of its package an add-on's manifest names: what decides, each page's bundle, and its sample data. */
function namedFiles(manifest: Doc): string[] {
  const addOn = (manifest['addOn'] ?? {}) as { provides?: { server?: string }[]; pages?: { client?: string }[]; slots?: { client?: string }[] };
  const sample = (manifest['sampleData'] as { file?: string } | undefined)?.file;
  const named = [...(addOn.provides ?? []).map((one) => one.server), ...(addOn.pages ?? []).map((one) => one.client), ...(addOn.slots ?? []).map((one) => one.client), sample];
  return [...new Set(named.filter((path): path is string => typeof path === 'string'))];
}

/** An add-on of the checkout as it is built, or null when the checkout or the build is not there. */
export function builtAddOn(key: string): BuiltAddOn | null {
  if (ADD_ONS_REPO === undefined || ADD_ONS_REPO === '') return null;
  const root = join(ADD_ONS_REPO, 'packages', key);
  if (!existsSync(join(root, 'manifest.json'))) return null;
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Doc;
  const files: Record<string, string> = {};
  for (const path of namedFiles(manifest)) {
    if (!existsSync(join(root, path))) return null;
    files[path] = readFileSync(join(root, path), 'utf8');
  }
  return { key, version: String(manifest['version']), manifest, files };
}

export interface Installed {
  h: Harness;
  addOn: BuiltAddOn;
  /** The install's own reply. */
  reply: Doc;
  /** The real name of one of the add-on's tables. */
  real: (ref: string) => string;
  /** Every row of one of the add-on's tables, by its short name. */
  rowsOf: (ref: string, where?: string) => Promise<Record<string, unknown>[]>;
  /** Tables of the owner's own, made beside the add-on's, by name. */
  hosts: string[];
}

/** A table of the owner's own that hands rows to the add-on: its columns after the key, and the rules that post. */
export interface HostTable {
  columns: string;
  postings: readonly unknown[];
}

/**
 * Installs a built add-on with no app, as a package that comes with the
 * server (so its deciding code is trusted to run), under the server's OWN list
 * of words it does not run yet: an add-on that leans on one is refused here
 * as it would be on a real server.
 */
export async function installBuilt(dialect: Dialect, addOn: BuiltAddOn, opts: HarnessOptions = {}, hosts: Record<string, HostTable> = {}): Promise<Installed> {
  const h = await addOnHarness(dialect, opts);
  await h.stageAddOn(addOn.manifest, { bundled: true, files: addOn.files });
  const res = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: addOn.key, version: addOn.version, attachTo: [] } });
  if (res.statusCode !== 200) {
    await h.close();
    throw new Error(`installing ${addOn.key} answered ${String(res.statusCode)}: ${res.body.slice(0, 1200)}`);
  }
  // The owner's own tables come after the install, as on a real connection: made, read, then given their rules.
  if (Object.keys(hosts).length > 0) {
    const serial = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : dialect === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    for (const [name, table] of Object.entries(hosts)) await h.rows(`CREATE TABLE ${name} (id ${serial}, ${table.columns})`);
    await h.introspect();
    const read = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    for (const [name, table] of Object.entries(hosts)) {
      const id = read.tables.find((one) => one.name === name)!.id;
      if (table.postings.length > 0) await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.postings', tableName: id, columnName: null, value: { postings: table.postings }, origin: 'user' } as never);
    }
  }
  const prefix = `${addOn.key.replace(/-/g, '_')}_`;
  const real = (ref: string) => `${prefix}${ref}`;
  return { h, addOn, reply: res.json() as Doc, real, rowsOf: (ref, where) => h.rows(`select * from ${real(ref)}${where === undefined ? '' : ` where ${where}`}`), hosts: Object.keys(hosts) };
}

/** Staff at a desk, as the dashboard writes: somebody who holds every role an add-on ships. */
export const DESK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
/** Somebody buying through an app's public page. */
export const BUYER: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key_1' }, request: null };
/** Staff who hold no role of the add-on's: a move that names roles is refused them. */
export const CLERK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_cal', label: 'Cal' }, request: null };

export interface Saved {
  row: Record<string, unknown>;
  /** What each ledger the save posted into said of it. */
  posted: PostedOutcome[];
}

export interface Writing extends Installed {
  /** A row of one of the add-on's tables made through the write service: its rules, its postings, the add-on's own code. */
  create(ref: string, values: Record<string, unknown>, context?: WriteContext): Promise<Saved>;
  update(ref: string, id: unknown, values: Record<string, unknown>, context?: WriteContext): Promise<Saved>;
  /** One row of a table by its key, as the database holds it now. */
  one(ref: string, id: unknown): Promise<Record<string, unknown>>;
  /** The name a table goes by in a row that points at it from anywhere (a link Inventory keeps to an owner's row). */
  storedName(ref: string): string;
  /** Every answer of the add-on's code that Adminium refused, with the check that refused it: what an audit row would say. */
  refused: LedgerRefusal[];
  /** The write service itself, for what writes on its own (an automation's step). */
  writes: ReturnType<typeof createWriteService>;
}

/**
 * The write service over an installed add-on, with the add-on's own built
 * file loaded as the code that decides — so a save here goes the whole way a
 * save on a server goes: the table's rules, the posting, the file run in its
 * bare context, the rows it answers checked and written, the totals settled.
 */
export async function writing(installed: Installed): Promise<Writing> {
  const { h, addOn } = installed;
  const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
  const view = new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
  const { db, dialect } = await h.manager.data(h.connectionId);
  const idOf = (ref: string) => {
    // One of the owner's own tables goes by its own name; the add-on's by their short ones.
    const found = model.tables.find((table) => table.name === (installed.hosts.includes(ref) ? ref : installed.real(ref)));
    if (found === undefined) throw new Error(`no table ${installed.real(ref)}`);
    return found.id;
  };
  const target = (ref: string): WriteTarget => ({ connectionId: h.connectionId, view, table: view.table(idOf(ref)), db, dialect, timezone: 'UTC' });
  const server = Object.entries(addOn.files).find(([path]) => path.endsWith('server.js'));
  if (server === undefined) throw new Error(`${addOn.key} names no file that decides`);
  const refused: LedgerRefusal[] = [];
  const decider = loadDecider({ key: addOn.key, version: addOn.version, path: server[0], bytes: Buffer.from(server[1], 'utf8') });
  const installs = keepAddOnInstalls(h.meta, async () => model);
  const deps: LedgerRuntimeDeps = {
    installs: () => installs.current(),
    refresh: () => installs.fresh(),
    decider: (key) => (key === addOn.key ? decider : null),
    versionNow: async (key) => {
      const row = await h.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
      return row === undefined ? null : { version: row.version, status: row.status };
    },
    refused: async (event) => {
      refused.push(event);
    },
  };
  // Who holds which role is the server's to read; here Ivy holds them all and nobody else holds any.
  const runtime = createLedgerRuntime(deps);
  const writes = createWriteService({ ...writeStores(h.meta), ledgers: runtime, rolesOf: async (actor) => (actor?.kind === 'user' && actor.id === 'usr_ivy' ? 'any' : new Set<string>()) });
  const one = async (ref: string, id: unknown) => {
    const [row] = installed.hosts.includes(ref) ? await h.rows(`select * from ${ref} where id = ${String(id)}`) : await installed.rowsOf(ref, `id = ${String(id)}`);
    if (row === undefined) throw new Error(`no row ${String(id)} in ${ref}`);
    return row;
  };
  return {
    ...installed,
    one,
    refused,
    writes,
    storedName: (ref) => runtime.refOf(h.connectionId, idOf(ref)),
    async create(ref, values, context = DESK) {
      const at = target(ref);
      let posted: PostedOutcome[] = [];
      const row = await writes.create({
        target: at,
        values: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, normalizeWriteValue(at.table.columns.get(name)!, value)])),
        context,
        announce: async (_row, _values, outcomes) => {
          posted = [...(outcomes ?? [])];
        },
      });
      return { row: row as Record<string, unknown>, posted };
    },
    async update(ref, id, values, context = DESK) {
      let posted: PostedOutcome[] = [];
      await writes.update({
        target: target(ref),
        pk: { id },
        values,
        context,
        announce: async (outcome) => {
          posted = [...(outcome.postings ?? [])];
        },
      });
      return { row: await one(ref, id), posted };
    },
  };
}
