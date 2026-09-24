// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chart's groups by name, on every engine: a group keyed by a foreign key
 * reads a column of the row it points at ("Dr Rao", not 7), under the caller's
 * own read and mask; a group keyed by a choice column reads its labels.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDatabaseModel, type Dialect } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { createSqliteMetaDb, firstRun, snapshotsRepo, type SchemaOverride } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { compileWidgetQuery } from '../src/widget-data/compiler.js';
import { groupLabelsFor } from '../src/widget-data/group-labels.js';
import { shapeRows } from '../src/widget-data/shapers.js';
import { TEST_SECRET } from './helpers.js';

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function clinic(dialect: Dialect) {
  const dataDir = await mkdtemp(join(tmpdir(), 'group-labels-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const name = `adminium_labels_${randomBytes(4).toString('hex')}`;
  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'clinic.db');
    new BetterSqlite3(file).close();
    dsn = `sqlite:${file}`;
  } else if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new Client({ connectionString: POSTGRES_URL });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    };
  } else {
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const connection = await manager.connections.create({ name: 'Clinic', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  const { db } = await manager.data(connection.id);
  await sql.raw('create table clinicians (id integer primary key, short_name varchar(20) not null, home_phone varchar(20))').execute(db);
  await sql
    .raw('create table visits (id integer primary key, clinician_id integer references clinicians(id), status varchar(12) not null)')
    .execute(db);
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const snapshot = (await snapshotsRepo(meta).latest(connection.id))!;
  const model = parseDatabaseModel(snapshot.schema);
  const visitsId = model.tables.find((t) => t.name === 'visits')!.id!;
  const cliniciansId = model.tables.find((t) => t.name === 'clinicians')!.id!;
  const override = (tableName: string, columnName: string, op: string, value: Record<string, unknown>) =>
    ({ id: `o_${op}`, connectionId: connection.id, op, tableName, columnName, value, origin: 'user', llmRunId: null, status: 'active', createdBy: null, createdAt: 0, updatedAt: 0 }) as SchemaOverride;
  const view = new SnapshotView(
    connection.id,
    applyOverrides(model, [
      override(visitsId, 'status', 'column.enumLabels', { labels: { booked: 'Booked', seen: 'Seen' } }),
      // A clinician's home phone is personal: masked for a reader without the grant.
      override(cliniciansId, 'home_phone', 'column.pii', { masked: true, kind: 'phone' }),
    ]),
    new Map(),
  );
  for (const [id, short] of [[1, 'Dr Rao'], [2, 'Nurse Kim'], [3, '']] as const) {
    await db.insertInto(cliniciansId as never).values({ id, short_name: short, home_phone: `0700${String(id)}` } as never).execute();
  }
  let id = 0;
  for (const [clinician, status] of [[1, 'booked'], [1, 'seen'], [2, 'booked'], [3, 'booked'], [null, 'seen']] as const) {
    id += 1;
    await db.insertInto(visitsId as never).values({ id, clinician_id: clinician, status } as never).execute();
  }
  close = async () => {
    await manager.disposeAll().catch(() => undefined);
    await drop();
    await meta.db.destroy();
    await rm(dataDir, { recursive: true, force: true });
  };
  const read = async (input: Record<string, unknown>, opts: { canReadTable?: boolean; canReadPii?: boolean } = {}) => {
    const source = { name: 'visits', ...(visitsId.includes('.') ? { schema: visitsId.split('.')[0] } : {}) };
    const descriptor = queryDescriptorSchema.parse({ connectionId: connection.id, source, shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], ...input });
    const canReadPii = opts.canReadPii ?? true;
    const compiled = compileWidgetQuery({ db, view, descriptor, params: {}, canReadPii, dialect, now: () => new Date() });
    const rows = (await compiled.query.execute()) as Record<string, unknown>[];
    const groupLabels = await groupLabelsFor({
      path: descriptor.groupLabel,
      compiled,
      rows,
      view,
      db,
      canReadPii,
      canReadTable: async () => opts.canReadTable ?? true,
    });
    const shaped = shapeRows({ compiled, rows, canReadPii, groupLabels }) as unknown as { items: { key: string; label: string; value: number }[] };
    return Object.fromEntries(shaped.items.map((item) => [item.key, item.label]));
  };
  /** A record list's column heads, as the grid reads them. */
  const listColumns = async () => {
    const source = { name: 'visits', ...(visitsId.includes('.') ? { schema: visitsId.split('.')[0] } : {}) };
    const descriptor = queryDescriptorSchema.parse({ connectionId: connection.id, source, shape: 'record-list', select: ['id', 'status'] });
    const compiled = compileWidgetQuery({ db, view, descriptor, params: {}, canReadPii: true, dialect, now: () => new Date() });
    const rows = (await compiled.query.execute()) as Record<string, unknown>[];
    return (shapeRows({ compiled, rows, canReadPii: true }) as unknown as { columns: Record<string, unknown>[] }).columns;
  };
  return { read, listColumns };
}

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`group labels on ${dialect}`, () => {
    it('names a foreign-key group by the row it points at, and a choice group by its labels', async () => {
      const c = await clinic(dialect);
      // By clinician: the name, a blank name keeps the key, no clinician is the dash.
      expect(await c.read({ groupBy: ['clinician_id'], groupLabel: 'clinician_id.short_name' })).toEqual({ '1': 'Dr Rao', '2': 'Nurse Kim', '3': '3', __null: '—' });
      // Without asking, a foreign key stays a key.
      expect(await c.read({ groupBy: ['clinician_id'] })).toEqual({ '1': '1', '2': '2', '3': '3', __null: '—' });
      // A choice column reads its labels.
      expect(await c.read({ groupBy: ['status'] })).toEqual({ booked: 'Booked', seen: 'Seen' });
    });

    it('hands a record list the words for a choice column\u2019s values', async () => {
      const c = await clinic(dialect);
      const columns = await c.listColumns();
      expect(columns.find((column) => column['name'] === 'status')).toMatchObject({ enumLabels: { booked: 'Booked', seen: 'Seen' } });
      expect(columns.find((column) => column['name'] === 'id')).not.toHaveProperty('enumLabels');
    });

    it('reads a label only as this caller may read it, and refuses one that is not one link away', async () => {
      const c = await clinic(dialect);
      // A table the caller may not read: the keys, never a failed widget.
      expect(await c.read({ groupBy: ['clinician_id'], groupLabel: 'clinician_id.short_name' }, { canReadTable: false })).toMatchObject({ '1': '1' });
      // A masked column reads only with the grant.
      expect(await c.read({ groupBy: ['clinician_id'], groupLabel: 'clinician_id.home_phone' }, { canReadPii: false })).toMatchObject({ '1': '1' });
      expect(await c.read({ groupBy: ['clinician_id'], groupLabel: 'clinician_id.home_phone' }, { canReadPii: true })).toMatchObject({ '1': '07001' });
      await expect(c.read({ groupBy: ['status'], groupLabel: 'clinician_id.short_name' })).rejects.toThrow('one link away');
      await expect(c.read({ groupBy: ['status'], groupLabel: 'status.short_name' })).rejects.toThrow('does not point');
      await expect(c.read({ groupBy: ['clinician_id'], groupLabel: 'clinician_id.nothing' })).rejects.toThrow('is not a column');
    });
  });
}
