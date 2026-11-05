// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SQLite time in a widget's rows is the instant it names, as the data
 * routes hand the same row.
 *
 * SQLite keeps this server's wall clock in a `timestamp` (`crud/instants.ts`).
 * The data routes, the record lookup and a live list's later rows send it as
 * the instant it denotes; a widget's list, its one record and a live list's
 * first rows sent the wall clock as it was stored, which a reader in another
 * zone than the server's read as their own: the list showed the row an hour
 * off the grid. Postgres and MySQL already answer with instants. Asked as a
 * reader who only reads the table, never as the admin.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';

/** Stored as this server's wall clock: noon on 5 November, here. */
const STORED = '2026-11-05 12:00:00';
const INSTANT = new Date(2026, 10, 5, 12, 0, 0).toISOString();

describe("a SQLite time in a widget's rows", () => {
  let t: DataTestContext;
  let dir: string;
  let connId: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'widget-instants-'));
    const file = join(dir, 'shop.db');
    const db = new BetterSqlite3(file);
    db.exec(`CREATE TABLE proofs (id INTEGER PRIMARY KEY, note VARCHAR(40), sent_at TIMESTAMP); INSERT INTO proofs (id, note, sent_at) VALUES (1, 'first', '${STORED}')`);
    db.close();
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `sqlite:${file}`, 'shop', 'sqlite');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.viewer, connId, 'main.proofs', { read: true });
  });
  afterAll(async () => {
    await t.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const widget = async (descriptor: Record<string, unknown>) => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/widget-data/query',
      headers: asUser(t.users.viewer),
      payload: { descriptor: { connectionId: connId, source: { name: 'proofs', schema: 'main' }, ...descriptor } },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { result: Record<string, unknown> }).result;
  };

  it('is the instant the data route reads for the same row', async () => {
    const read = await t.app.inject({ method: 'GET', url: `/api/v1/data/${connId}/main.proofs/1`, headers: asUser(t.users.viewer) });
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { data: { sent_at: unknown } }).data.sent_at).toBe(INSTANT);

    const list = (await widget({ shape: 'record-list', orderBy: [{ column: 'id', dir: 'asc' }], limit: 5 })) as { rows: Record<string, unknown>[] };
    expect(list.rows.map((row) => row['sent_at'])).toEqual([INSTANT]);
  });

  it('is the instant in a single record too', async () => {
    const one = (await widget({ shape: 'record', filters: [{ column: 'id', op: 'eq', value: 1 }] })) as { row: Record<string, unknown> | null };
    expect(one.row?.['sent_at']).toBe(INSTANT);
  });
});
