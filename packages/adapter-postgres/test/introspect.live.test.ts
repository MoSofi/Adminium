/**
 * Live introspection tests, gated on a local Postgres probe (the standing
 * rule: CI without PG stays green). These suites drive the FULL introspection
 * pipeline through the psql-backed executor, so they run even before the
 * `pg` driver is installed; `adapter.live.test.ts` re-verifies the same
 * behavior through the real pool.
 *
 * The headline assertion: loading `fixtures/northwind.sql` into a fresh
 * `adminium_test_adapter_*` database and introspecting it deep-equals the
 * shared engine contract fixture
 * (`packages/engine/test/fixtures/northwind.model.json`) after normalizing
 * order and the volatile fields (introspectedAt, stats.durationMs,
 * rowCountEstimate, sizeBytes, activity, warnings — the same set the
 * canonical snapshot hash strips, 05 §9).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine/adapter';

// NOTE: imports go through src/introspect.js (not src/index.js) so this suite
// has no dependency on the `pg` driver being installed.
import { interpretProbe, introspectPostgres, PROBE_SQL } from '../src/introspect.js';
import {
  createTestDatabase,
  dropTestDatabase,
  loadEngineFixture,
  normalizeModel,
  psql,
  psqlAvailable,
  psqlExecutor,
} from './harness.js';

describe.skipIf(!psqlAvailable)('northwind fixture equivalence (psql executor)', () => {
  let db = '';
  let model: DatabaseModel;
  let statements = 0;

  beforeAll(async () => {
    db = await createTestDatabase(true);
    const exec = psqlExecutor(db);
    model = await introspectPostgres(exec, { connectionId: db, databaseName: db }, {
      schemas: ['public'],
    });
    statements = exec.count();
  }, 60_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
  });

  it('deep-equals the shared engine fixture after normalization', () => {
    expect(normalizeModel(model)).toEqual(normalizeModel(loadEngineFixture()));
  });

  it('is a valid DatabaseModel per the engine Zod contract', () => {
    expect(() => parseDatabaseModel(JSON.stringify(model))).not.toThrow();
  });

  it('collects row estimates from pg_class.reltuples (never COUNT)', () => {
    const byId = new Map(model.tables.map((t) => [t.id, t]));
    expect(byId.get('public.categories')?.rowCountEstimate).toBe(8);
    expect(byId.get('public.employees')?.rowCountEstimate).toBe(9);
    expect(byId.get('public.order_details')?.rowCountEstimate).toBe(52);
    expect(byId.get('public.categories')?.rowCountExact).toBe(false);
  });

  it('stays within the statement budget (≤ 12, fixed set)', () => {
    expect(statements).toBe(7);
    expect(statements).toBeLessThanOrEqual(12);
  });

  it('detects the self-referential employees.reports_to FK', () => {
    const selfFk = model.relations.find((r) => r.selfReferential);
    expect(selfFk?.id).toBe('fk:public.employees(reports_to)->public.employees(employee_id)');
    expect(selfFk?.from.columns).toEqual(['reports_to']);
  });

  it('skips relations whose target is filtered out, with a warning', async () => {
    const exec = psqlExecutor(db);
    const filtered = await introspectPostgres(
      exec,
      { connectionId: db, databaseName: db },
      { schemas: ['public'], tableFilter: ({ name }) => name !== 'orders' },
    );
    expect(filtered.tables.some((t) => t.name === 'orders')).toBe(false);
    expect(filtered.relations.some((r) => r.id.includes('public.orders'))).toBe(false);
    expect(filtered.warnings.some((w) => w.code === 'fk-target-excluded')).toBe(true);
  });
});

describe.skipIf(!psqlAvailable)('enums, identity, checks, views (extras schema)', () => {
  let db = '';
  let model: DatabaseModel;

  beforeAll(async () => {
    db = await createTestDatabase(false);
    await psql(
      `CREATE SCHEMA extras;
       CREATE TYPE extras.ticket_status AS ENUM ('open', 'pending', 'closed');
       CREATE TABLE extras.tickets (
         id bigint GENERATED ALWAYS AS IDENTITY,
         status extras.ticket_status NOT NULL DEFAULT 'open',
         priority character varying(10) NOT NULL DEFAULT 'medium'
           CONSTRAINT tickets_priority_check CHECK (priority IN ('low', 'medium', 'high')),
         code character varying(12) NOT NULL,
         title text NOT NULL,
         title_upper text GENERATED ALWAYS AS (upper(title)) STORED,
         tags text[],
         created_at timestamp with time zone NOT NULL DEFAULT now(),
         external_ref uuid DEFAULT gen_random_uuid(),
         score numeric(6,2),
         CONSTRAINT tickets_pkey PRIMARY KEY (id),
         CONSTRAINT tickets_code_key UNIQUE (code)
       );
       COMMENT ON TABLE extras.tickets IS 'Support tickets';
       COMMENT ON COLUMN extras.tickets.status IS 'Workflow state';
       CREATE INDEX tickets_created_at_idx ON extras.tickets (created_at);
       CREATE VIEW extras.open_tickets AS
         SELECT id, title FROM extras.tickets WHERE status = 'open';`,
      { db },
    );
    model = await introspectPostgres(psqlExecutor(db), { connectionId: db, databaseName: db }, {
      schemas: ['extras'],
    });
  }, 60_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
  });

  const ticketsColumn = (name: string) =>
    model.tables.find((t) => t.id === 'extras.tickets')?.columns.find((c) => c.name === name);

  it('honors the schema filter', () => {
    expect(model.schemas).toEqual(['extras']);
    expect(model.tables.map((t) => t.id)).toEqual(['extras.open_tickets', 'extras.tickets']);
  });

  it('maps native enum types with ordered values', () => {
    const native = model.enums.find((e) => e.id === 'extras.ticket_status');
    expect(native).toMatchObject({
      name: 'ticket_status',
      values: ['open', 'pending', 'closed'],
      source: 'native',
    });
    expect(ticketsColumn('status')).toMatchObject({
      logicalType: 'enum',
      enumRef: 'extras.ticket_status',
      default: { kind: 'literal', text: "'open'::extras.ticket_status" },
      comment: 'Workflow state',
    });
  });

  it('synthesizes an EnumDef from CHECK (col IN (...))', () => {
    const synthesized = model.enums.find((e) => e.id === 'extras.tickets.priority');
    expect(synthesized).toMatchObject({
      values: ['low', 'medium', 'high'],
      source: 'check',
    });
    expect(ticketsColumn('priority')).toMatchObject({
      logicalType: 'varchar',
      maxLength: 10,
      enumRef: 'extras.tickets.priority',
    });
    expect(model.tables.find((t) => t.id === 'extras.tickets')?.checks).toHaveLength(1);
  });

  it('maps identity → autoincrement and generated columns', () => {
    expect(ticketsColumn('id')).toMatchObject({
      logicalType: 'bigint',
      isPrimaryKey: true,
      isUnique: true,
      default: { kind: 'autoincrement' },
    });
    expect(ticketsColumn('title_upper')).toMatchObject({ isGenerated: true, default: null });
  });

  it('maps arrays, now()/uuid defaults, and numeric precision', () => {
    expect(ticketsColumn('tags')).toMatchObject({
      isArray: true,
      logicalType: 'text',
      dbType: 'text[]',
    });
    expect(ticketsColumn('created_at')).toMatchObject({
      logicalType: 'timestamptz',
      default: { kind: 'now' },
    });
    expect(ticketsColumn('external_ref')).toMatchObject({ default: { kind: 'uuid' } });
    expect(ticketsColumn('score')).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: 6,
      numericScale: 2,
    });
  });

  it('captures uniques, indexes, and table comments', () => {
    const tickets = model.tables.find((t) => t.id === 'extras.tickets');
    expect(tickets?.comment).toBe('Support tickets');
    expect(tickets?.uniques).toEqual([{ name: 'tickets_code_key', columns: ['code'] }]);
    expect(tickets?.indexes.map((i) => i.name)).toEqual([
      'tickets_code_key',
      'tickets_created_at_idx',
      'tickets_pkey',
    ]);
    expect(ticketsColumn('code')?.isUnique).toBe(true);
  });

  it('lists views read-only-shaped (no PK, no activity, no estimate)', () => {
    const view = model.tables.find((t) => t.id === 'extras.open_tickets');
    expect(view).toMatchObject({
      kind: 'view',
      primaryKey: [],
      rowCountEstimate: null,
      activity: null,
    });
  });
});

describe.skipIf(!psqlAvailable)('read-only detection (capability probe SQL)', () => {
  let db = '';
  const suffix = Math.random().toString(36).slice(2, 8);
  const roRole = `adminium_test_ro_${suffix}`;
  const rwRole = `adminium_test_rw_${suffix}`;

  beforeAll(async () => {
    db = await createTestDatabase(false);
    await psql(`CREATE ROLE ${roRole} LOGIN`);
    await psql(`CREATE ROLE ${rwRole} LOGIN`);
    await psql(`GRANT CREATE ON DATABASE ${db} TO ${rwRole}`);
  }, 60_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
    await psql(`DROP ROLE IF EXISTS ${roRole}`);
    await psql(`DROP ROLE IF EXISTS ${rwRole}`);
  });

  const probeAs = async (user?: string) => {
    const rows = await psqlExecutor(db, user)(PROBE_SQL);
    return interpretProbe(rows[0] ?? {});
  };

  it('a role without CREATE on the database reads as read-only', async () => {
    const probe = await probeAs(roRole);
    expect(probe.roleName).toBe(roRole);
    expect(probe.canCreate).toBe(false);
    expect(probe.readOnly).toBe(true);
  });

  it('a role with CREATE on the database reads as writable', async () => {
    const probe = await probeAs(rwRole);
    expect(probe.canCreate).toBe(true);
    expect(probe.readOnly).toBe(false);
  });

  it('default_transaction_read_only=on flips a writable role to read-only', async () => {
    await psql(`ALTER ROLE ${rwRole} SET default_transaction_read_only = 'on'`);
    const probe = await probeAs(rwRole);
    expect(probe.canCreate).toBe(true);
    expect(probe.readOnly).toBe(true);
  });

  it('the maintenance superuser reads as writable with a server version', async () => {
    const probe = await probeAs();
    expect(probe.readOnly).toBe(false);
    expect(probe.serverVersion).toMatch(/^\d+\./);
    expect(probe.databaseName).toBe(db);
  });
});

describe.skipIf(!psqlAvailable)('reserved schemas (adminium_demo)', () => {
  let db = '';

  beforeAll(async () => {
    db = await createTestDatabase(false);
    // Mirrors what the example apps' db/demo-toolkit.sql installs: a ledger of
    // which rows came from their seed, in a schema of ours rather than theirs.
    await psql(
      `CREATE TABLE public.orders (id serial PRIMARY KEY, total numeric(10,2) NOT NULL);
       CREATE SCHEMA adminium_demo;
       CREATE TABLE adminium_demo.seeded_rows (
         schema_name text NOT NULL, table_name text NOT NULL, pk text[] NOT NULL,
         PRIMARY KEY (schema_name, table_name, pk)
       );`,
      { db },
    );
  }, 60_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
  });

  it('is left out of an unscoped introspection, so it never becomes an admin page', async () => {
    const model = await introspectPostgres(
      psqlExecutor(db),
      { connectionId: db, databaseName: db },
      {},
    );
    expect(model.schemas).not.toContain('adminium_demo');
    expect(model.tables.map((t) => t.schema)).not.toContain('adminium_demo');
    expect(model.tables.map((t) => t.name)).toContain('orders');
  });

  it('is still returned when asked for by name', async () => {
    const model = await introspectPostgres(
      psqlExecutor(db),
      { connectionId: db, databaseName: db },
      { schemas: ['adminium_demo'] },
    );
    expect(model.tables.map((t) => t.name)).toEqual(['seeded_rows']);
  });
});
