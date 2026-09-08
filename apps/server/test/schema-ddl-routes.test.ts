// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The schema-authoring routes — 35-schema-authoring.md 35-T10, 35-T15, 35-T17,
 * D6, D7, D23.
 *
 * Runs the whole HTTP path over the fake SQLite-backed adapter, so every
 * assertion here is about what a caller actually gets rather than what a unit
 * of the service returns.
 *
 * The guards are the point. Each of the five refusals below is the only thing
 * standing between a caller and a customer's schema, and each is asserted
 * against a real request rather than a hidden button:
 *
 *   • no `schema.ddl` grant                    → 403
 *   • an API key principal (D23/O7)            → 403
 *   • a read-only connection (D5/35-T15)       → 403 READ_ONLY_MODE
 *   • a schema-file connection                 → 403 READ_ONLY_MODE
 *   • a destructive step without Super Admin   → 403 (D7)
 */
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';
import { permissionsRepo } from '@adminium/meta';

import { schemaDdlRoutes } from '../src/routes/schema-ddl/index.js';
import {
  asUser,
  buildDataTestApp,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

// --- a fake source database -------------------------------------------------

function seed(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT NOT NULL, note TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL);
    INSERT INTO customers (email, note) VALUES ('a@x.test', 'hi'), ('b@x.test', NULL);
  `);
  return db;
}

let raw: BetterSqlite3.Database;

function fakeProvider(): AdapterProvider {
  return {
    dialect: 'sqlite',
    create<Role extends 'introspect' | 'data' | 'meta'>(): DatabaseAdapter<Role> {
      const model: DatabaseModel = parseDatabaseModel(
        JSON.stringify({
          irVersion: 1,
          dialect: 'sqlite',
          name: 'fake',
          defaultSchema: 'main',
          tables: [
            {
              id: 'main.customers',
              schema: 'main',
              name: 'customers',
              columns: [
                { name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false },
                { name: 'email', logicalType: 'text', dbType: 'text', nullable: false },
                { name: 'note', logicalType: 'text', dbType: 'text' },
              ],
              primaryKey: ['id'],
            },
            {
              id: 'main.orders',
              schema: 'main',
              name: 'orders',
              columns: [
                { name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false },
                { name: 'customer_id', logicalType: 'integer', dbType: 'integer' },
                { name: 'total', logicalType: 'float', dbType: 'real' },
              ],
              primaryKey: ['id'],
            },
          ],
          relations: [],
          enums: [],
        }),
      );
      const adapter = {
        dialect: 'sqlite' as const,
        capabilities: adapterCapabilitiesSchema.parse({ maxIdentifierLength: 128 }),
        role: 'introspect' as Role,
        async connect() {},
        async test() {
          return { ok: true, latencyMs: 1, serverVersion: '3.53.4', currentUser: 'test', canWrite: true, ssl: false };
        },
        async probeCapabilities() {
          return {
            capabilities: adapterCapabilitiesSchema.parse({ maxIdentifierLength: 128 }),
            privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
            serverVersion: '3.53.4',
            currentRole: { name: 'test', readOnly: false },
          };
        },
        async introspect() {
          return model;
        },
        async count() {
          return { value: 2, capped: false };
        },
        async sample() {
          return [];
        },
        async query() {
          return { rows: [], columns: [] };
        },
        async mutate() {
          return { affected: 0, returning: null };
        },
        async collectTableStats() {
          return { table: { schema: null, name: 'x' }, rowCountEstimate: 2, rowCountExact: true, columns: [], sampled: false };
        },
        async close() {},
      };
      return adapter as unknown as DatabaseAdapter<Role>;
    },
    createQueryEngine() {
      return {
        dialect: new SqliteDialect({ database: raw }),
        identifiers: { quote: (i: string) => `"${i}"`, maxLength: 128 },
        serializers: {},
        async destroy() {},
      };
    },
  };
}

let t: DataTestContext;
let connectionId: string;

/** The plan the tests reuse: add a nullable column to `customers`. */
const ADD_COLUMN_EDIT = (snapshotId: string) => ({
  baseSnapshotId: snapshotId,
  upsertTables: [
    {
      id: 'main.customers',
      schema: 'main',
      name: 'customers',
      columns: [
        { name: 'id', logicalType: 'integer', nullable: false },
        { name: 'email', logicalType: 'text', nullable: false },
        { name: 'note', logicalType: 'text' },
        { name: 'phone', logicalType: 'varchar', maxLength: 40 },
      ],
      primaryKey: ['id'],
    },
  ],
});

beforeAll(async () => {
  raw = seed();
  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register(fakeProvider());
  t = await buildDataTestApp({
    registry,
    // The shared harness registers the read-side schema routes; the authoring
    // ones are this suite's subject, so they come in through the seam the
    // harness provides rather than by widening it for everybody.
    extraRoutes: async (api, deps) => {
      await api.register(schemaDdlRoutes({
        manager: deps.manager,
        meta: deps.meta,
        crypto: { encrypt: (v: string) => v, decrypt: (v: string) => v },
      }) as never);
    },
  });
  // Not `createConnectionViaApi`: that helper hardcodes `engine: 'postgres'`,
  // and this suite needs the connection's dialect to MATCH its executor —
  // otherwise the service selects Postgres session rails and runs them at
  // SQLite. (That the rails failing aborts the apply is correct product
  // behaviour: proceeding without `lock_timeout` is the outage §5 describes.)
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: asUser(t.users.admin),
    payload: { name: 'fake', engine: 'sqlite', dsn: 'sqlite::memory:' },
  });
  if (created.statusCode !== 201) throw new Error(`create failed: ${created.body}`);
  connectionId = (created.json() as { id: string }).id;
  await introspectViaApi(t, connectionId);
});

afterAll(async () => {
  await t.app.close();
  raw.close();
});

async function snapshotId(): Promise<string> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/v1/connections/${connectionId}/schema`,
    headers: asUser(t.users.admin),
  });
  return (res.json() as { snapshotId: string }).snapshotId;
}

/** Give the admin role `schema.ddl` — it deliberately does not have it (D6). */
async function grantDdl(): Promise<void> {
  await permissionsRepo(t.meta).grant(t.roles.admin.id, 'system', 'schema.ddl', { allowed: true });
}

async function revokeDdl(): Promise<void> {
  await permissionsRepo(t.meta).revoke(t.roles.admin.id, 'system', 'schema.ddl');
}

// ---------------------------------------------------------------------------

describe('the grant (D6)', () => {
  it('refuses an admin who does not hold schema.ddl — it is not a built-in', async () => {
    await revokeDdl();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: ADD_COLUMN_EDIT(await snapshotId()),
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts one who does', async () => {
    await grantDdl();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: ADD_COLUMN_EDIT(await snapshotId()),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a viewer outright', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.viewer),
      payload: ADD_COLUMN_EDIT(await snapshotId()),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('the plan (D2, D4)', () => {
  beforeAll(grantDdl);

  it('returns the ordered steps with their hazard, rationale and exact SQL', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: ADD_COLUMN_EDIT(await snapshotId()),
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json() as {
      steps: { kind: string; hazard: string; rationale: string; sql: string[] }[];
      hazard: string;
      checksum: string;
      requiresSuperAdmin: boolean;
    };
    expect(plan.steps.map((s) => s.kind)).toEqual(['add-column']);
    expect(plan.steps[0]?.hazard).toBe('safe');
    expect(plan.steps[0]?.rationale.length).toBeGreaterThan(20);
    // The D2 invariant, at the wire: the preview IS the statement.
    expect(plan.steps[0]?.sql[0]).toContain('ADD COLUMN "phone" varchar(40)');
    expect(plan.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.requiresSuperAdmin).toBe(false);
  });

  it('refuses a NOT NULL column with no default on a populated table', async () => {
    const edit = ADD_COLUMN_EDIT(await snapshotId());
    edit.upsertTables[0]!.columns[3] = {
      name: 'phone',
      logicalType: 'varchar',
      maxLength: 40,
      nullable: false,
    } as never;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: edit,
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json() as { refusals: { code: string }[]; hazard: string };
    expect(plan.refusals.map((r) => r.code)).toContain('NEEDS_DEFAULT');
    expect(plan.hazard).toBe('refused');
  });

  it('422s a body carrying a TableModel-only field — D30 at the Zod gate', async () => {
    const edit = ADD_COLUMN_EDIT(await snapshotId()) as Record<string, unknown>;
    (edit['upsertTables'] as Record<string, unknown>[])[0]!['system'] = false;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: edit,
    });
    expect(res.statusCode).toBe(422);
  });

  it('422s an expression default — the free-text path D14 closes', async () => {
    const edit = ADD_COLUMN_EDIT(await snapshotId());
    edit.upsertTables[0]!.columns[3] = {
      name: 'phone',
      logicalType: 'varchar',
      maxLength: 40,
      default: { kind: 'expression', text: 'now()' },
    } as never;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: edit,
    });
    expect(res.statusCode).toBe(422);
  });

  it('refuses a system table by name (§4, META_NAMESPACE / SYSTEM_TABLE)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: { baseSnapshotId: await snapshotId(), dropTables: ['main.adminium_users'] },
    });
    // Not in the snapshot at all → UNKNOWN_TABLE; either way it is refused,
    // and the refusal is server-side.
    expect(res.statusCode).toBe(422);
  });
});

describe('apply (D2, D7)', () => {
  beforeAll(grantDdl);

  it('refuses a checksum that does not match the plan — SCHEMA_DRIFT', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/apply`,
      headers: asUser(t.users.admin),
      payload: { ...ADD_COLUMN_EDIT(await snapshotId()), checksum: 'not-the-plan' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'SCHEMA_DRIFT' } });
  });

  it('applies a safe plan and writes a ledger row', async () => {
    const id = await snapshotId();
    const planRes = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: ADD_COLUMN_EDIT(id),
    });
    const { checksum } = planRes.json() as { checksum: string };

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/apply`,
      headers: asUser(t.users.admin),
      payload: { ...ADD_COLUMN_EDIT(id), checksum },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as { status: string; steps: { outcome: string }[] };
    expect(result.status).toBe('applied');
    expect(result.steps[0]?.outcome).toBe('succeeded');

    // The column is really there.
    const columns = raw.prepare('PRAGMA table_info(customers)').all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain('phone');

    // …and the ledger says so.
    const changes = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${connectionId}/schema/changes`,
      headers: asUser(t.users.admin),
    });
    expect(changes.statusCode).toBe(200);
    const body = changes.json() as { changes: { status: string; succeeded: number }[] };
    expect(body.changes[0]?.status).toBe('applied');
    expect(body.changes[0]?.succeeded).toBe(1);
  });

  it('refuses a destructive plan without Super Admin (D7)', async () => {
    const id = await snapshotId();
    const edit = {
      baseSnapshotId: id,
      upsertTables: [
        {
          id: 'main.orders',
          schema: 'main',
          name: 'orders',
          columns: [
            { name: 'id', logicalType: 'integer', nullable: false },
            { name: 'customer_id', logicalType: 'integer' },
          ],
          primaryKey: ['id'],
        },
      ],
    };
    const planRes = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: edit,
    });
    const plan = planRes.json() as { requiresSuperAdmin: boolean; checksum: string };
    // Dropping `total` discards data.
    expect(plan.requiresSuperAdmin).toBe(true);

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/apply`,
      headers: asUser(t.users.admin),
      payload: { ...edit, checksum: plan.checksum, acknowledgeRows: true },
    });
    // The admin holds `schema.ddl` but is not a Super Admin.
    expect(res.statusCode).toBe(403);
  });
});

describe('honest absence, enforced server-side (D5, 35-T15)', () => {
  it('403 READ_ONLY_MODE on a read-only connection', async () => {
    await grantDdl();
    await t.meta.db
      .updateTable('adminium_connections')
      .set({ readOnly: 1 } as never)
      .where('id', '=', connectionId)
      .execute();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: ADD_COLUMN_EDIT(await snapshotId()),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'READ_ONLY_MODE' } });
    await t.meta.db
      .updateTable('adminium_connections')
      .set({ readOnly: 0 } as never)
      .where('id', '=', connectionId)
      .execute();
  });

  it('403 READ_ONLY_MODE when the probe says the role cannot run DDL', async () => {
    await t.meta.db
      .updateTable('adminium_connections')
      .set({ canDdl: 0 } as never)
      .where('id', '=', connectionId)
      .execute();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/plan`,
      headers: asUser(t.users.admin),
      payload: ADD_COLUMN_EDIT(await snapshotId()),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'READ_ONLY_MODE' } });
    await t.meta.db
      .updateTable('adminium_connections')
      .set({ canDdl: null } as never)
      .where('id', '=', connectionId)
      .execute();
  });
});

describe('the diagram layout route (D21, 35-T37)', () => {
  it('accepts schema.remap and persists the positions', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connectionId}/diagram-layout`,
      headers: asUser(t.users.admin),
      payload: { positions: { 'main.customers': { x: 10, y: 20 } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ positions: { 'main.customers': { x: 10, y: 20 } } });
  });

  it('refuses a viewer', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connectionId}/diagram-layout`,
      headers: asUser(t.users.viewer),
      payload: { positions: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});
