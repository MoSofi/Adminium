// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE ROW PER VALUE, through the create route.
 *
 * The claim that matters is atomicity: five invitations are five rows or none.
 * A list half written, with no way back, is worse than one refused — so the
 * refusal case is tested as hard as the happy one, and the single undo token
 * has to take every row with it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

interface Mutation {
  data: Record<string, unknown> | null;
  undoToken: string | null;
  created?: number;
}

describe('one record per chip', () => {
  let dir: string;
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'adminium-repeat-'));
    const file = join(dir, 'team.db');
    const db = new BetterSqlite3(file);
    db.exec(
      `CREATE TABLE invites (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         email VARCHAR(60) NOT NULL UNIQUE,
         role VARCHAR(20) NOT NULL)`,
    );
    db.close();
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `sqlite:${file}`, 'team', 'sqlite');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (body: unknown) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/invites`,
      headers: asUser(t.users.admin),
      payload: body as never,
    });

  const rows = async (): Promise<Record<string, unknown>[]> => {
    const reply = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/invites?limit=100&order=id.asc`,
      headers: asUser(t.users.admin),
    });
    return reply.json<{ data: Record<string, unknown>[] }>().data;
  };

  it('writes one row per value, sharing the rest of the form', async () => {
    const reply = await post({
      values: { role: 'member' },
      repeat: { column: 'email', values: ['ada@example.com', 'grace@example.com'] },
    });
    expect(reply.statusCode, reply.body).toBe(201);
    const body = reply.json<Mutation>();
    // The count is in the reply: a caller counting rows would otherwise say
    // "1 record added" about two.
    expect(body.created).toBe(2);
    const written = await rows();
    expect(written.map((row) => row['email'])).toEqual(['ada@example.com', 'grace@example.com']);
    expect(written.every((row) => row['role'] === 'member')).toBe(true);
  });

  it('takes every row back with ONE undo', async () => {
    const before = (await rows()).length;
    const reply = await post({
      values: { role: 'viewer' },
      repeat: { column: 'email', values: ['a@x.test', 'b@x.test', 'c@x.test'] },
    });
    const token = reply.json<Mutation>().undoToken;
    expect((await rows()).length).toBe(before + 3);

    const undone = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${String(token)}`,
      headers: asUser(t.users.admin),
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect((await rows()).length).toBe(before);
  });

  it('writes NONE of them when one is refused', async () => {
    const before = await rows();
    const reply = await post({
      values: { role: 'member' },
      // The second one is already taken — a UNIQUE violation halfway through.
      repeat: { column: 'email', values: ['new@x.test', 'ada@example.com', 'later@x.test'] },
    });
    expect(reply.statusCode).toBeGreaterThanOrEqual(400);
    // Not one of the three, including the one that came BEFORE the refusal.
    expect((await rows()).map((row) => row['email'])).toEqual(before.map((row) => row['email']));
  });

  it('refuses a column the table does not have', async () => {
    const reply = await post({
      values: { role: 'member' },
      repeat: { column: 'nope', values: ['x@x.test'] },
    });
    expect(reply.statusCode).toBe(422);
  });

  it('refuses to combine it with a relation field', async () => {
    const reply = await post({
      values: { role: 'member' },
      repeat: { column: 'email', values: ['solo@x.test'] },
      children: { 'some-relation': [] },
    });
    // "The same links on five rows" is a decision nobody has made, so it is
    // refused rather than guessed at.
    expect(reply.statusCode).toBe(422);
  });
});
