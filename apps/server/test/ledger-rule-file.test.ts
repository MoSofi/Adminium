// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OWNER'S RULE TRAVELS IN THE PROJECT'S SCHEMA FILE; AN APP'S DOES NOT.
 *
 * A posting the owner drew and the switch they flipped are theirs: they are
 * written into `schema/<database>.json` and read back on another server. A
 * rule an app's manifest stored is not in the file (its install writes it
 * again) and applying a file leaves it where it is. A rule that arrives by
 * file is judged where it lands: into an add-on that is not installed there
 * it reads as not there; naming something the add-on does not have, it
 * cannot answer — and is never half-run.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { overridesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { parseDatabaseModel } from '@adminium/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { applySchemaFile } from '../src/project/apply-files.js';
import { findInstanceIds } from '../src/project/instance-ids.js';
import { fileHash } from '../src/project/project-files.js';
import { readSchemaFile, toSchemaFile } from '../src/project/schema-files.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const COUNT: Doc = { into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['counted'] } } };
const COLUMNS = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';

describe.each(LEGS)('an owner\'s rule in the schema file — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  let cookie = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const orders = () => w.target('orders').table.id;
  const api = (method: string, url: string, payload?: unknown) => served.composed.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const rule = (posting: string) => `/connections/${w.h.connectionId}/tables/${encodeURIComponent(orders())}/postings/${posting}`;
  const listed = async (connectionId = w.h.connectionId) => ((await api('GET', `/ledgers/ledger-kit/units/postings?connectionId=${connectionId}`)).json() as { postings: Doc[] }).postings;
  const stored = (connectionId = w.h.connectionId) => overridesRepo(w.h.meta).listForConnection(connectionId);

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { orders: { columns: COLUMNS, postings: [] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2)`);
    // The app's own rule on the table, as its install stores one.
    await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.postings', tableName: orders(), columnName: null, value: { postings: [{ id: 'shipped', ...COUNT }] }, origin: 'app' } as never);
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const desk = await usersRepo(w.h.meta).create({ email: 'desk@file.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(w.h.meta).assignToUser(desk.id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
    cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@file.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!available) return;
    await served?.close();
    await w?.close();
  });

  it.skipIf(!available)('the owner\'s posting and switch are in the file, the app\'s rule is not — and applying the file leaves the app\'s rule where it is', async () => {
    // As the owner: a second rule on the table, and the app's own switched off.
    expect((await api('PUT', rule('by-hand'), COUNT)).statusCode).toBe(200);
    expect((await api('PATCH', `${rule('shipped')}/switch`, { enabled: false })).statusCode).toBe(200);
    const before = await stored();
    const appRow = before.find((row) => row.origin === 'app' && row.op === 'table.postings')!;

    const file = toSchemaFile(before);
    const rows = (file['overrides'] as Doc[]).filter((row) => String(row['op']).startsWith('table.'));
    expect(rows.map((row) => row['op']).sort()).toEqual(['table.postings', 'table.switchedOff']);
    expect(rows.find((row) => row['op'] === 'table.postings')).toMatchObject({ table: orders(), value: { postings: [{ id: 'by-hand' }] } });
    expect((rows.find((row) => row['op'] === 'table.postings')!['value'] as { postings: Doc[] }).postings).toHaveLength(1);
    expect(rows.find((row) => row['op'] === 'table.switchedOff')).toMatchObject({ value: { postings: ['shipped'] } });
    // No row says whose it is (every row of a file is the owner's), and nothing in it is an id of this install.
    for (const row of rows) expect(row).not.toHaveProperty('origin');
    expect(JSON.stringify(file)).not.toContain('"shipped","into"');
    expect(findInstanceIds(file)).toEqual([]);
    const read = readSchemaFile(file);
    if (!read.ok) throw new Error(read.problems.join('; '));
    expect(fileHash('schema/main.json', toSchemaFile(before))).toBe(fileHash('schema/main.json', file));

    // Applied to the same database: the app's row is the very row it was; both rules are on the table, the app's off.
    await applySchemaFile(w.h.meta, w.h.connectionId, read.rows, Date.now());
    const after = await stored();
    expect(after.find((row) => row.origin === 'app' && row.op === 'table.postings')).toMatchObject({ id: appRow.id, value: appRow.value });
    const told = (await listed()).filter((entry) => entry['table'] === orders());
    expect(told.map((entry) => `${String(entry['id'])}:${String(entry['enabled'])}:${String(entry['state'])}:${entry['owner'] === null ? 'owner' : 'app'}`).sort()).toEqual(['by-hand:true:live:owner', 'shipped:false:off:app']);
  });

  it.skipIf(!available)('read on a database where the add-on is not installed, the rule is as if not there: a save posts nothing and is not refused', async () => {
    // A second database with the same table and no add-on installed for it.
    if (dialect === 'sqlite') {
      const file = new BetterSqlite3(join(w.h.dataDir, 'elsewhere.db'));
      file.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ${COLUMNS})`);
      file.close();
    }
    const elsewhere = await w.h.addConnection('elsewhere');
    const read = readSchemaFile(toSchemaFile(await stored()));
    if (!read.ok) throw new Error(read.problems.join('; '));
    await applySchemaFile(w.h.meta, elsewhere, read.rows, Date.now());
    const there = await stored(elsewhere);
    expect(there.filter((row) => row.op === 'table.postings').map((row) => `${row.origin}:${JSON.stringify((row.value as { postings: Doc[] }).postings.map((posting) => posting['id']))}`)).toEqual(['user:["by-hand"]']);
    const model = applyOverrides(parseDatabaseModel((await snapshotsRepo(w.h.meta).latest(elsewhere))!.schema), there.filter((row) => row.status === 'active'));
    const table = model.tables.find((candidate) => candidate.name === 'orders')!;
    expect(table.postings?.map((posting) => posting.id)).toEqual(['by-hand']);
    const receipts = await w.count('ledger_kit_postings');
    const made = await api('POST', `/data/${elsewhere}/${encodeURIComponent(table.id)}`, { values: { account_id: 1, qty: '1', status: 'counted' } });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).not.toHaveProperty('postings');
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
    // The add-on keeps no ledger there for a rules page to list.
    expect((await api('GET', `/ledgers/ledger-kit/units/postings?connectionId=${elsewhere}`)).statusCode).toBe(404);
  });

  it.skipIf(!available)('a file whose rule names an action the ledger does not have is taken, and the rule cannot answer: listed so, and a save that would fire it is refused', async () => {
    const file = toSchemaFile(await stored()) as { overrides: Doc[] };
    const wrong = { ...file, overrides: file.overrides.map((row) => (row['op'] === 'table.postings' ? { ...row, value: { postings: [{ id: 'by-hand', ...COUNT, into: { addOn: 'ledger-kit', ledger: 'units', action: 'juggle' } }] } } : row)) };
    const read = readSchemaFile(wrong);
    if (!read.ok) throw new Error(read.problems.join('; '));
    await applySchemaFile(w.h.meta, w.h.connectionId, read.rows, Date.now());
    expect((await listed()).find((entry) => entry['id'] === 'by-hand')).toMatchObject({ state: 'unavailable', action: 'juggle', owner: null });
    const before = await w.count('orders');
    const refused = await api('POST', `/data/${w.h.connectionId}/${encodeURIComponent(orders())}`, { values: { account_id: 1, qty: '1', status: 'counted' } });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { code: string; details: Doc } }).error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    expect(await w.count('orders')).toBe(before);
    // The same for an input the action does not take: named, never passed over.
    const odd = { ...file, overrides: file.overrides.map((row) => (row['op'] === 'table.postings' ? { ...row, value: { postings: [{ id: 'by-hand', ...COUNT, map: { account: 'account_id', quantity: 'qty', colour: 'status' } }] } } : row)) };
    const oddRead = readSchemaFile(odd);
    if (!oddRead.ok) throw new Error(oddRead.problems.join('; '));
    await applySchemaFile(w.h.meta, w.h.connectionId, oddRead.rows, Date.now());
    expect((await listed()).find((entry) => entry['id'] === 'by-hand')).toMatchObject({ state: 'unavailable', action: 'count' });
    // The file as it was puts the rule right again.
    const right = readSchemaFile(file);
    if (!right.ok) throw new Error(right.problems.join('; '));
    await applySchemaFile(w.h.meta, w.h.connectionId, right.rows, Date.now());
    expect((await listed()).find((entry) => entry['id'] === 'by-hand')).toMatchObject({ state: 'live' });
  });
});
