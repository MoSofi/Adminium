// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `created_at` the DATABASE fills with "now", on a table Adminium did not
 * make, comes back as the moment the row was made.
 *
 * A timestamp with no zone is this server's wall clock, read and written.
 * SQLite's `current_timestamp` is UTC's, so on a server that is not in UTC a
 * new row read two hours early (a server at UTC+2). MySQL had the same fault
 * and its fix; this holds both, through the data route itself.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { legs, signIn, stack, type Stack } from './assistant-lodge.helpers.js';

const KEY = { sqlite: 'integer primary key', mysql: 'int auto_increment primary key', postgres: 'serial primary key' } as const;

for (const [dialect, available] of legs) {
  // PostgreSQL fills in its own session's zone, which is not this server's to set here.
  describe.skipIf(!available || dialect === 'postgres')(`a timestamp the database fills — ${dialect}`, () => {
    let s: Stack;
    let owner: string;
    let table: string;
    const zone = process.env.TZ;

    beforeAll(async () => {
      // Far from UTC, and from wherever this machine is.
      process.env.TZ = 'Asia/Tokyo';
      s = await stack(dialect);
      await s.run(`create table walk_notes (id ${KEY[dialect]}, note varchar(60) not null, created_at timestamp not null default current_timestamp, updated_at timestamp not null default current_timestamp)`);
      await runIntrospection({ manager: s.manager, meta: s.meta, connectionId: s.connectionId });
      const model = parseDatabaseModel((await snapshotsRepo(s.meta).latest(s.connectionId))!.schema);
      table = model.tables.find((entry) => entry.name === 'walk_notes')!.id;
      owner = await signIn(s.app, 'owner@lodge.dev');
    }, 60_000);

    afterAll(async () => {
      await s.close();
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    it('answers a new row`s created_at as the moment it was made', async () => {
      const before = Date.now();
      const res = await s.app.inject({
        method: 'POST',
        url: `/api/v1/data/${s.connectionId}/${encodeURIComponent(table)}`,
        headers: { cookie: owner },
        payload: { values: { note: 'made now' } },
      });
      expect(res.statusCode, res.body).toBe(201);
      const row = (res.json() as { data: { id: number; created_at: string; updated_at: string } }).data;
      const made = Date.parse(row.created_at);
      expect(Math.abs(made - before), row.created_at).toBeLessThan(60_000);
      expect(Math.abs(Date.parse(row.updated_at) - before), row.updated_at).toBeLessThan(60_000);

      // …and read back the same from the list.
      const read = await s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${encodeURIComponent(table)}/${String(row.id)}`, headers: { cookie: owner } });
      expect(read.statusCode, read.body).toBe(200);
      expect((read.json() as { data: { created_at: string } }).data.created_at).toBe(row.created_at);
    });
  });
}
