// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN INSTANT COMPARED WITH A TIME THAT KEEPS NO ZONE, ON EVERY ENGINE.
 *
 * A zone-less `timestamp` (Postgres `timestamp`, MySQL `DATETIME`, SQLite
 * text) holds this server's wall clock: every write stores it that way
 * (`normalizeWriteValue` in `crud/write-values.ts`). Two readers compared it
 * with UTC's wall clock instead, so on a server off UTC they were off by its
 * offset:
 *
 *   - a filter whose value is an instant with a zone (`…T22:00:00.000Z`) —
 *     an API caller's, a saved filter's. Postgres drops the zone when it casts
 *     the value to `timestamp`; MySQL and SQLite compare the text as it was.
 *   - a widget's rolling window (`last: 1, unit: 'hour'`), whose bounds were
 *     spelled as UTC wall time on MySQL and SQLite.
 *
 * Nothing shows on a server in UTC, and CI runs in UTC, so this file picks a
 * zone of its own when it is given none (vitest forks a process per file). Run
 * it under any other: `TZ=Europe/Berlin npx vitest run test/zone-less-time-bounds.test.ts`.
 *
 * Postgres and MySQL gate on TEST_POSTGRES_URL / TEST_MYSQL_URL (`''` counts
 * as absent).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseModel } from '@adminium/engine';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import type { RecordFilter } from '../src/crud/filters.js';
import { SnapshotView, type ResolvedTable } from '../src/crud/identifiers.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { compileWidgetQuery } from '../src/widget-data/compiler.js';
import { shapeRows } from '../src/widget-data/shapers.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';

if (process.env.TZ === undefined || process.env.TZ === '' || /^(Etc\/)?(UTC|GMT)$/i.test(process.env.TZ)) {
  process.env.TZ = 'America/New_York';
}

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** "Now" for the widget: 23:00 UTC. */
const NOW = new Date('2026-07-27T23:00:00.000Z');

/** Three visits, as instants; stored as this server's wall clock. */
const VISITS = [
  { label: 'early', at: '2026-07-27T21:30:00.000Z', amount: 1 },
  { label: 'middle', at: '2026-07-27T22:30:00.000Z', amount: 10 },
  { label: 'late', at: '2026-07-27T23:30:00.000Z', amount: 100 },
] as const;

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** An empty database on this engine: its DSN, and how to drop it. */
async function emptyDatabase(dialect: Dialect, dir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `adminium_zoneless_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dir, 'visits.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    return {
      dsn: withDatabase(POSTGRES_URL as string, name),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  return {
    dsn: withDatabase(MYSQL_URL as string, name),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`a zone-less time on ${dialect}, on a server in ${process.env.TZ}`, () => {
    let dir: string;
    let drop: () => Promise<void> = async () => undefined;
    let t: DataTestContext;
    let connId: string;
    let view: SnapshotView;
    let table: ResolvedTable;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'zoneless-'));
      const made = await emptyDatabase(dialect, dir);
      drop = made.drop;
      t = await buildDataTestApp();
      connId = await createConnectionViaApi(t, made.dsn, 'visits', dialect);
      const { db } = await t.manager.data(connId);
      const at = dialect === 'mysql' ? 'datetime' : 'timestamp';
      await sql.raw(`create table visits (id integer primary key, label varchar(20) not null, seen_at ${at} not null, amount integer not null)`).execute(db);
      await introspectViaApi(t, connId);
      await t.grantTable(t.roles.admin, connId, '*', { read: true });
      const snapshot = await snapshotsRepo(t.meta).latest(connId);
      const active = await overridesRepo(t.meta).listForConnection(connId, { status: 'active' });
      view = new SnapshotView(connId, applyOverrides(snapshot?.schema as DatabaseModel, active), new Map());
      table = view.table(view.model.tables.find((candidate) => candidate.name === 'visits')!.id);
      const column = table.columns.get('seen_at')!;
      // Written as the write path writes a zone-less time: this server's wall clock.
      for (const [i, visit] of VISITS.entries()) {
        await db
          .insertInto(table.id as never)
          .values({ id: i + 1, label: visit.label, seen_at: normalizeWriteValue(column, visit.at), amount: visit.amount } as never)
          .execute();
      }
    });

    afterAll(async () => {
      await t?.app.close();
      await drop();
      await rm(dir, { recursive: true, force: true });
    });

    it('reads the table the way this suite depends on', () => {
      expect(table.columns.get('seen_at')?.logicalType).toBe('timestamp');
    });

    it('answers a filter on an instant with a zone against the instant', async () => {
      const labels = async (filter: RecordFilter) => {
        const reply = await t.app.inject({
          method: 'GET',
          url: `/api/v1/data/${connId}/${table.id}?where=${encodeURIComponent(JSON.stringify(filter))}&order=id.asc`,
          headers: asUser(t.users.admin),
        });
        expect(reply.statusCode, reply.body).toBe(200);
        return reply.json<{ data: { label: string }[] }>().data.map((row) => row.label);
      };
      expect(await labels({ column: 'seen_at', op: 'lt', value: '2026-07-27T23:00:00.000Z' })).toEqual(['early', 'middle']);
      expect(await labels({ column: 'seen_at', op: 'gte', value: '2026-07-27T22:00:00.000Z' })).toEqual(['middle', 'late']);
      expect(await labels({ column: 'seen_at', op: 'between', value: ['2026-07-27T22:00:00Z', '2026-07-28T01:00:00+02:00'] })).toEqual(['middle']);
      expect(await labels({ column: 'seen_at', op: 'eq', value: '2026-07-27T22:30:00.000Z' })).toEqual(['middle']);
      expect(await labels({ column: 'seen_at', op: 'in', value: ['2026-07-27T21:30:00Z', '2026-07-27T19:30:00-04:00'] })).toEqual(['early', 'late']);
      // A time with no zone is this server's wall clock already, and passes as it is.
      const wall = normalizeWriteValue(table.columns.get('seen_at')!, '2026-07-27T22:30:00.000Z');
      expect(await labels({ column: 'seen_at', op: 'eq', value: wall })).toEqual(['middle']);
    });

    it("counts a widget's rolling window from the instants it names", async () => {
      const { db } = await t.manager.data(connId);
      const total = async (last: number) => {
        const descriptor = queryDescriptorSchema.parse({
          connectionId: connId,
          source: { name: 'visits', ...(table.id.includes('.') ? { schema: table.id.split('.')[0] } : {}) },
          shape: 'single-metric',
          aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }],
          window: { column: 'seen_at', last, unit: 'hour' },
        });
        const compiled = compileWidgetQuery({ db, view, descriptor, canReadPii: true, dialect, now: () => NOW });
        const rows = (await compiled.query.execute()) as Record<string, unknown>[];
        return (shapeRows({ compiled, rows, canReadPii: true }) as unknown as { value: unknown }).value;
      };
      // The last hour before 23:00 UTC holds the 22:30 visit; the last two, the 21:30 one too.
      expect(Number(await total(1))).toBe(10);
      expect(Number(await total(2))).toBe(11);
    });
  });
}
