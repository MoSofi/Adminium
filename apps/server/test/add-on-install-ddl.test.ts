// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `applyInstall` — the DDL an add-on install actually runs.
 *
 * Two kinds of assertion, and both are needed:
 *
 *  - **Executed**, against a real SQLite database. A `CREATE TABLE` that
 *    compiles and then fails to run is the failure this replaces, so the tables
 *    are created for real, written to, and read back — including the foreign key
 *    and the enum's CHECK, which are the two constraints that exist to reject
 *    something.
 *  - **Compiled**, for all three dialects. The type map is the substance of this
 *    task and most of it cannot be exercised without a server, so the emitted
 *    SQL is asserted directly. `pg` and `mysql2` are already dependencies here,
 *    and Kysely's compilers need no connection — only `.execute()` does.
 *
 * The manifests are the SHIPPED ones, copied verbatim from `Adminiumjs/add-ons`.
 * Three of the six declare tables and all three are here, because the point of
 * a type map is the types that real add-ons actually use: eight of the fifteen.
 *
 * Every add-on keys its tables with `id`, which is why an APP is here too. Apps
 * key theirs with `int` and `text`, and a foreign key typed for `id` against
 * those is refused by postgres and mysql — while SQLite, which checks no FK
 * column type, accepted it. Every published app failed to install on both
 * server engines with this whole file green.
 */

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { planInstall, type RequiredTable } from '@adminium/manifest';

import {
  AddOnInstallError,
  applyInstall,
  type ExistingTable,
} from '../src/add-ons/install-ddl.js';

// ── the shipped manifests' tables ────────────────────────────────────────────

/** `design-studio` — one table, and its only FK points at the HOST's `jobs`. */
const DESIGN_STUDIO: RequiredTable[] = [
  {
    ref: 'artwork_designs',
    columns: [
      { ref: 'id', type: 'id', role: 'pk' },
      { ref: 'job_id', type: 'fk', references: 'jobs' },
      { ref: 'product', type: 'text' },
      { ref: 'width_mm', type: 'decimal' },
      { ref: 'height_mm', type: 'decimal' },
      { ref: 'bleed_mm', type: 'decimal' },
      { ref: 'doc', type: 'json' },
      { ref: 'preview_file', type: 'text', nullable: true },
      { ref: 'created_at', type: 'timestamptz', role: 'created_at' },
      { ref: 'updated_at', type: 'timestamptz', role: 'updated_at' },
    ],
  },
];

/** `shipping-dhl` — an enum, a money column, and an FK between its own tables. */
const SHIPPING_DHL: RequiredTable[] = [
  {
    ref: 'shipments',
    columns: [
      { ref: 'id', type: 'id', role: 'pk' },
      { ref: 'order_reference', type: 'text' },
      { ref: 'carrier', type: 'text' },
      { ref: 'service', type: 'text' },
      { ref: 'tracking', type: 'text' },
      { ref: 'label_file', type: 'text', nullable: true },
      { ref: 'amount', type: 'money', semantic: 'money' },
      { ref: 'currency', type: 'text' },
      { ref: 'collection_from', type: 'timestamptz' },
      { ref: 'collection_to', type: 'timestamptz' },
      {
        ref: 'status',
        type: 'enum',
        enum: ['booked', 'collected', 'in-transit', 'delivered', 'cancelled', 'refused'],
      },
      { ref: 'created_at', type: 'timestamptz', role: 'created_at' },
    ],
  },
  {
    ref: 'shipment_events',
    columns: [
      { ref: 'id', type: 'id', role: 'pk' },
      { ref: 'shipment_id', type: 'fk', references: 'shipments' },
      { ref: 'at', type: 'timestamptz' },
      { ref: 'place', type: 'text' },
      { ref: 'status', type: 'text' },
      { ref: 'description', type: 'text' },
    ],
  },
];

/** `personalizer` — two tables, one referencing the other AND two host tables. */
const PERSONALIZER: RequiredTable[] = [
  {
    ref: 'personalization_templates',
    columns: [
      { ref: 'id', type: 'id', role: 'pk' },
      { ref: 'product_id', type: 'fk', references: 'products' },
      { ref: 'angles', type: 'json' },
      { ref: 'zones', type: 'json' },
      { ref: 'created_at', type: 'timestamptz', role: 'created_at' },
      { ref: 'updated_at', type: 'timestamptz', role: 'updated_at' },
    ],
  },
  {
    ref: 'personalizations',
    columns: [
      { ref: 'id', type: 'id', role: 'pk' },
      { ref: 'order_line_id', type: 'fk', references: 'order_lines' },
      { ref: 'template_id', type: 'fk', references: 'personalization_templates' },
      { ref: 'values', type: 'json' },
      { ref: 'preview_file', type: 'text', nullable: true },
      { ref: 'production_file', type: 'text', nullable: true },
      { ref: 'created_at', type: 'timestamptz', role: 'created_at' },
    ],
  },
];

/**
 * `hotel-reservations`, trimmed to the keys — the shipped app whose schema
 * exercises every shape a key can take: a `text` primary key (`room_types`), a
 * natural `int` one (`rooms.number`), and a table referencing both.
 */
const HOTEL: RequiredTable[] = [
  {
    ref: 'room_types',
    columns: [
      { ref: 'id', type: 'text', role: 'pk' },
      { ref: 'name', type: 'text', semantic: 'name' },
    ],
  },
  {
    ref: 'rooms',
    columns: [
      { ref: 'number', type: 'int', role: 'pk' },
      { ref: 'type_id', type: 'fk', references: 'room_types' },
      { ref: 'note', type: 'text', nullable: true },
    ],
  },
  {
    ref: 'stays',
    columns: [
      { ref: 'ref', type: 'text', role: 'pk' },
      { ref: 'type_id', type: 'fk', references: 'room_types' },
      { ref: 'room_number', type: 'fk', references: 'rooms', nullable: true },
    ],
  },
];

// ── harness ──────────────────────────────────────────────────────────────────

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const open: (() => Promise<void>)[] = [];

/** A real SQLite database with the given host tables already in it. */
function sqliteWith(hostTables: string[]): { db: AnyDb; raw: BetterSqlite3.Database } {
  const raw = new BetterSqlite3(':memory:');
  // OFF by default in SQLite — without it the FK constraints this file creates
  // would exist in the schema and enforce nothing, and the test asserting one
  // rejects a bad row would pass for the wrong reason.
  raw.pragma('foreign_keys = ON');
  for (const table of hostTables) {
    raw.exec(`create table ${table} (id text primary key, label text)`);
  }
  const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
  open.push(async () => {
    await db.destroy();
  });
  return { db, raw };
}

/** What `sqliteWith` created, in the shape `applyInstall` reads. */
function hostSchema(hostTables: string[]): ExistingTable[] {
  return hostTables.map((ref) => ({
    ref,
    columns: [
      { ref: 'id', isPrimaryKey: true },
      { ref: 'label', isPrimaryKey: false },
    ],
  }));
}

/** A plan for these tables against a database holding only `hostTables`. */
function planFor(tables: RequiredTable[], hostTables: string[]) {
  return planInstall(
    {
      key: 'fixture',
      version: '1.0.0',
      requiredSchema: { tables },
    } as never,
    { tables: hostSchema(hostTables) },
  );
}

/** A Kysely bound to a dialect's COMPILER only — no connection is ever made. */
function compilerFor(dialect: 'postgres' | 'mysql' | 'sqlite'): AnyDb {
  if (dialect === 'postgres') {
    return new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) }) as AnyDb;
  }
  if (dialect === 'mysql') {
    return new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) }) as AnyDb;
  }
  return new Kysely({
    dialect: new SqliteDialect({ database: {} as never }),
  }) as AnyDb;
}

/** The SQL `applyInstall` would run, without running it. */
async function sqlFor(
  tables: RequiredTable[],
  hostTables: string[],
  dialect: 'postgres' | 'mysql' | 'sqlite',
  existing: ExistingTable[] = hostSchema(hostTables),
): Promise<string[]> {
  const statements: string[] = [];
  const db = compilerFor(dialect);
  // A `Kysely` whose `executeQuery` records instead of connecting. Compiling
  // through the real builder rather than calling `.compile()` by hand keeps the
  // assertion on the SQL `applyInstall` itself produces.
  const recording = db.withPlugin({
    transformQuery: (args) => args.node,
    transformResult: async (args) => args.result,
  }) as AnyDb;
  const original = (
    recording as unknown as { getExecutor(): { executeQuery: unknown; compileQuery(n: unknown): { sql: string } } }
  ).getExecutor();
  const executor = original as unknown as {
    executeQuery: (compiled: { sql: string }) => Promise<unknown>;
    compileQuery: (node: unknown, id: unknown) => { sql: string };
  };
  executor.executeQuery = async (compiled) => {
    statements.push(compiled.sql);
    return { rows: [] };
  };
  await applyInstall({
    plan: planFor(tables, hostTables),
    tables,
    db: recording,
    dialect,
    existing,
  });
  return statements;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map(async (close) => close()));
});

// ── executed, against a real database ────────────────────────────────────────

describe('applyInstall against a real SQLite database', () => {
  it("creates design-studio's table and lets a row reference the HOST's jobs", async () => {
    const { db, raw } = sqliteWith(['jobs']);
    const result = await applyInstall({
      plan: planFor(DESIGN_STUDIO, ['jobs']),
      tables: DESIGN_STUDIO,
      db,
      dialect: 'sqlite',
      existing: hostSchema(['jobs']),
    });
    expect(result.created).toEqual(['artwork_designs']);

    raw.exec(`insert into jobs (id, label) values ('j1', 'a job')`);
    await db
      .insertInto('artwork_designs')
      .values({
        id: 'd1',
        job_id: 'j1',
        product: 'poster',
        width_mm: 210,
        height_mm: 297,
        bleed_mm: 3,
        doc: '{}',
        preview_file: null,
        created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:00Z',
      })
      .execute();

    const rows = await db.selectFrom('artwork_designs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { job_id: string }).job_id).toBe('j1');
  });

  it('creates a foreign key that actually REJECTS a dangling reference', async () => {
    // The constraint has to be real. `addForeignKeyConstraint` is table-level
    // and named for exactly this reason — the inline column form is parsed and
    // then discarded by MySQL, so a passing "the column exists" test would say
    // nothing about whether anything is enforced.
    const { db } = sqliteWith(['jobs']);
    await applyInstall({
      plan: planFor(DESIGN_STUDIO, ['jobs']),
      tables: DESIGN_STUDIO,
      db,
      dialect: 'sqlite',
      existing: hostSchema(['jobs']),
    });
    await expect(
      db
        .insertInto('artwork_designs')
        .values({
          id: 'd2',
          job_id: 'does-not-exist',
          product: 'poster',
          width_mm: 1,
          height_mm: 1,
          bleed_mm: 0,
          doc: '{}',
          preview_file: null,
          created_at: 'now',
          updated_at: 'now',
        })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("creates shipping-dhl's enum as a CHECK that rejects a value outside it", async () => {
    const { db } = sqliteWith([]);
    const result = await applyInstall({
      plan: planFor(SHIPPING_DHL, []),
      tables: SHIPPING_DHL,
      db,
      dialect: 'sqlite',
      existing: [],
    });
    expect(result.created).toEqual(['shipments', 'shipment_events']);

    const row = {
      id: 's1',
      order_reference: 'SO-1',
      carrier: 'dhl',
      service: 'express',
      tracking: 'JD1',
      label_file: null,
      amount: 12.5,
      currency: 'EUR',
      collection_from: 'now',
      collection_to: 'later',
      created_at: 'now',
    };
    await db.insertInto('shipments').values({ ...row, status: 'booked' }).execute();
    await expect(
      db.insertInto('shipments').values({ ...row, id: 's2', status: 'teleported' }).execute(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('creates a table whose FK target is DECLARED AFTER IT, by ordering the creates', async () => {
    // Declaration order is the author's; creation order is this file's problem.
    // Reversed here on purpose: `personalizations` references
    // `personalization_templates`, so emitting them in the given order would
    // fail on every dialect that checks a constraint's target at creation.
    const reversed = [...PERSONALIZER].reverse();
    const { db } = sqliteWith(['products', 'order_lines']);
    const result = await applyInstall({
      plan: planFor(reversed, ['products', 'order_lines']),
      tables: reversed,
      db,
      dialect: 'sqlite',
      existing: hostSchema(['products', 'order_lines']),
    });
    expect(result.created).toEqual(['personalization_templates', 'personalizations']);
  });

  it('is re-runnable, because MySQL cannot roll a failed multi-table install back', async () => {
    const { db } = sqliteWith([]);
    const input = {
      plan: planFor(SHIPPING_DHL, []),
      tables: SHIPPING_DHL,
      db,
      dialect: 'sqlite' as const,
      existing: [],
    };
    await applyInstall(input);
    // Same input, second time: no error, and nothing is dropped or duplicated.
    await expect(applyInstall(input)).resolves.toBeTruthy();
    const tables = await sql<{
      name: string;
    }>`select name from sqlite_master where type = 'table'`.execute(db);
    expect(tables.rows.map((r) => r.name).sort()).toContain('shipments');
  });

  it("gives an app's foreign keys their TARGET's key type, not a fixed id type", async () => {
    const { db, raw } = sqliteWith([]);
    const result = await applyInstall({
      plan: planFor(HOTEL, []),
      tables: HOTEL,
      db,
      dialect: 'sqlite',
      existing: [],
    });
    expect(result.created).toEqual(['room_types', 'rooms', 'stays']);

    const typeOf = (table: string, column: string): string =>
      (raw.pragma(`table_info(${table})`) as { name: string; type: string }[]).find(
        (c) => c.name === column,
      )!.type.toLowerCase();
    expect(typeOf('stays', 'room_number')).toBe('integer');
    expect(typeOf('stays', 'type_id')).toBe('text');

    // The affinity is the point on SQLite, which never refuses the mismatch:
    // under `text` a room number reads back as the STRING '101'.
    raw.exec(`insert into room_types values ('dbl', 'Double')`);
    raw.exec(`insert into rooms values (101, 'dbl', null)`);
    raw.exec(`insert into stays values ('S-1', 'dbl', 101)`);
    const row = raw.prepare('select room_number from stays').get() as { room_number: unknown };
    expect(row.room_number).toBe(101);
    expect(() => raw.exec(`insert into stays values ('S-2', 'dbl', 999)`)).toThrow(/FOREIGN KEY/);
  });

  it('reports what it reused rather than pretending it created it', async () => {
    const { db } = sqliteWith(['jobs', 'artwork_designs']);
    const plan = planFor(DESIGN_STUDIO, ['jobs', 'artwork_designs']);
    const result = await applyInstall({
      plan,
      tables: DESIGN_STUDIO,
      db,
      dialect: 'sqlite',
      existing: hostSchema(['jobs', 'artwork_designs']),
    });
    expect(result.created).toEqual([]);
    expect(result.reused).toEqual(['artwork_designs']);
  });
});

// ── refusals ─────────────────────────────────────────────────────────────────

describe('applyInstall refuses rather than guesses', () => {
  it('will not apply a plan the planner refused', async () => {
    const { db } = sqliteWith([]);
    // `jobs` is absent, so the FK is unresolved and the plan is not installable.
    const plan = planFor(DESIGN_STUDIO, []);
    expect(plan.installable).toBe(false);
    await expect(
      applyInstall({ plan, tables: DESIGN_STUDIO, db, dialect: 'sqlite', existing: [] }),
    ).rejects.toThrow(AddOnInstallError);
  });

  it('refuses a host table with a COMPOSITE primary key instead of picking one', async () => {
    // `references` names a table, never a column, so a composite key leaves
    // nothing for a single FK column to point at. Guessing `id` would create a
    // constraint against a column that may not even exist.
    const { db } = sqliteWith([]);
    const existing: ExistingTable[] = [
      {
        ref: 'jobs',
        columns: [
          { ref: 'tenant', isPrimaryKey: true },
          { ref: 'id', isPrimaryKey: true },
        ],
      },
    ];
    await expect(
      applyInstall({
        plan: planInstall(
          { key: 'f', version: '1.0.0', requiredSchema: { tables: DESIGN_STUDIO } } as never,
          { tables: existing },
        ),
        tables: DESIGN_STUDIO,
        db,
        dialect: 'sqlite',
        existing,
      }),
    ).rejects.toThrow(/composite primary key/);
  });

  it("resolves an FK against the LIVE table, not the manifest's idea of it", async () => {
    // A reused table is in BOTH lists. The database wins: an author's `id` says
    // nothing about what the operator actually called their key, and pointing a
    // constraint at the wrong column is a create-time failure at best.
    const { db } = sqliteWith([]);
    // `personalization_templates` already exists, keyed `template_ref`.
    await sql
      .raw('create table personalization_templates (template_ref text primary key)')
      .execute(db);
    await sql.raw('create table products (id text primary key)').execute(db);
    await sql.raw('create table order_lines (id text primary key)').execute(db);
    const existing: ExistingTable[] = [
      { ref: 'personalization_templates', columns: [{ ref: 'template_ref', isPrimaryKey: true }] },
      { ref: 'products', columns: [{ ref: 'id', isPrimaryKey: true }] },
      { ref: 'order_lines', columns: [{ ref: 'id', isPrimaryKey: true }] },
    ];
    const result = await applyInstall({
      plan: planInstall(
        { key: 'f', version: '1.0.0', requiredSchema: { tables: PERSONALIZER } } as never,
        { tables: existing },
      ),
      tables: PERSONALIZER,
      db,
      dialect: 'sqlite',
      existing,
    });
    expect(result.created).toEqual(['personalizations']);

    const keys = await sql<{
      to: string;
    }>`select "to" from pragma_foreign_key_list('personalizations')`.execute(db);
    expect(keys.rows.map((r) => r.to)).toContain('template_ref');
  });

  it('refuses a host table with NO primary key', async () => {
    const { db } = sqliteWith([]);
    const existing: ExistingTable[] = [{ ref: 'jobs', columns: [{ ref: 'id' }] }];
    await expect(
      applyInstall({
        plan: planInstall(
          { key: 'f', version: '1.0.0', requiredSchema: { tables: DESIGN_STUDIO } } as never,
          { tables: existing },
        ),
        tables: DESIGN_STUDIO,
        db,
        dialect: 'sqlite',
        existing,
      }),
    ).rejects.toThrow(/no primary key/);
  });
});

// ── compiled, for all three dialects ─────────────────────────────────────────

describe('the column-type map, per dialect', () => {
  it('gives postgres real timestamps, jsonb, and a varchar id — never bpchar', async () => {
    const [statement] = await sqlFor(DESIGN_STUDIO, ['jobs'], 'postgres');
    // `varchar(36)`, not `char(36)`: bpchar blank-pads to the declared width on
    // write and hands the padding back on every read, so any id shorter than 36
    // comes out with trailing spaces.
    expect(statement).toContain('"id" varchar(36) primary key');
    expect(statement).not.toContain('"id" char(36)');
    // A REAL timestamp, not the meta store's epoch-milliseconds integer: these
    // tables sit in the operator's database beside their own data, where a
    // `created_at` holding 1750000000000 is unreadable to every other tool.
    expect(statement).toContain('"created_at" timestamptz not null');
    expect(statement).toContain('"doc" jsonb not null');
    expect(statement).toContain('"width_mm" decimal(19,4)');
  });

  it('gives mysql datetime and json — and a named table-level FK', async () => {
    const [statement] = await sqlFor(DESIGN_STUDIO, ['jobs'], 'mysql');
    expect(statement).toContain('`created_at` datetime not null');
    expect(statement).toContain('`doc` json not null');
    // Named and table-level. MySQL parses the inline column-level `references`
    // form and then silently discards it, which is the trap the meta migrations
    // already carry a comment about.
    expect(statement).toContain('constraint `fk_artwork_designs_job_id` foreign key');
  });

  it('gives sqlite its four storage classes and nothing it does not have', async () => {
    const [statement] = await sqlFor(DESIGN_STUDIO, ['jobs'], 'sqlite');
    // A timestamp is DECLARED `timestamp`, not `text`: SQLite keeps the
    // declared type, the introspector reads it back as a timestamp from that,
    // and an app's calendar page can only compose over a column that reads
    // back as one. Storage is unchanged (NUMERIC affinity keeps ISO text).
    expect(statement).toContain('"created_at" timestamp not null');
    expect(statement).toContain('"doc" text not null');
    expect(statement).toContain('"width_mm" real not null');
    expect(statement).not.toContain('timestamptz');
    expect(statement).not.toContain('jsonb');
  });

  it('declares an enum just wide enough for the workflow rule to read it', async () => {
    // `r07-status-workflow` accepts a text enum only at maxLength <= 32. At
    // `varchar(64)` / `text`, no installed app's status was ever a workflow
    // status, and a board over the app's own table could never compose.
    const tables: RequiredTable[] = [
      {
        ref: 'tickets',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'status', type: 'enum', enum: ['open', 'in_progress', 'done'] },
          { ref: 'note', type: 'enum', enum: ['a'.repeat(33), 'b'] },
        ],
      },
    ];
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const [statement] = await sqlFor(tables, [], dialect);
      expect(statement, dialect).toMatch(/status["`] varchar\(32\)/);
      // A value longer than 32 characters keeps the old width.
      expect(statement, dialect).toMatch(/note["`] varchar\(64\)/);
    }
  });

  it('emits money as decimal(19,4) on both server dialects, never a float', async () => {
    // Four decimal places is what accounting systems settled on, and binary
    // floating point cannot represent a tenth of a cent.
    for (const dialect of ['postgres', 'mysql'] as const) {
      const [statement] = await sqlFor(SHIPPING_DHL, [], dialect);
      expect(statement).toContain('amount');
      expect(statement).toMatch(/amount["`] decimal\(19,4\)/);
    }
  });

  it('escapes a backslash in an enum value on MYSQL, where it is an escape char', async () => {
    // The enum's values are the only manifest-authored TEXT that reaches
    // emitted SQL. MySQL treats `\` as an escape inside a string literal unless
    // the server runs NO_BACKSLASH_ESCAPES, so a value ending in one would
    // otherwise escape its own closing quote and run the rest as SQL.
    const nasty: RequiredTable[] = [
      {
        ref: 'flags',
        columns: [
          { ref: 'id', type: 'id', role: 'pk' },
          { ref: 'kind', type: 'enum', enum: ['ok', "back\\", "it's"] },
        ],
      },
    ];
    const [my] = await sqlFor(nasty, [], 'mysql');
    expect(my).toContain("'back\\\\'");
    expect(my).toContain("'it''s'");
    // Postgres leaves the backslash alone — standard_conforming_strings has
    // been on by default since 9.1, so doubling it there would store two.
    const [pg] = await sqlFor(nasty, [], 'postgres');
    expect(pg).toContain("'back\\'");
    expect(pg).toContain("'it''s'");
  });

  it('quotes the enum CHECK for the dialect it is running on', async () => {
    const [pg] = await sqlFor(SHIPPING_DHL, [], 'postgres');
    expect(pg).toContain(`check ("status" in ('booked'`);
    const [my] = await sqlFor(SHIPPING_DHL, [], 'mysql');
    expect(my).toContain('check (`status` in (\'booked\'');
  });

  it('marks only the nullable columns nullable, on every dialect', async () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const [statement] = await sqlFor(DESIGN_STUDIO, ['jobs'], dialect);
      // `preview_file` is the manifest's only `nullable: true`.
      expect(statement).toMatch(/preview_file`?"? text(?! not null)/);
      expect(statement).toMatch(/product`?"? text not null/);
    }
  });

  it("types an app's foreign keys like the keys they point at, on every dialect", async () => {
    const [, rooms, stays] = await sqlFor(HOTEL, [], 'postgres');
    // An int key numbers itself; the FK below still takes `integer`.
    expect(rooms).toContain('"number" integer generated by default as identity primary key');
    expect(rooms).toContain('"type_id" text not null');
    expect(stays).toContain('"room_number" integer');
    expect(stays).not.toContain('varchar(36)');

    const [sqliteRooms, , sqliteStays] = await sqlFor(HOTEL, [], 'sqlite');
    expect(sqliteRooms).toContain('"id" text primary key');
    expect(sqliteStays).toContain('"room_number" integer');
  });

  it('gives mysql a varchar for a text KEY, which it cannot index, and only there', async () => {
    // "BLOB/TEXT column 'id' used in key specification without a key length".
    const [types, rooms, stays] = await sqlFor(HOTEL, [], 'mysql');
    expect(types).toContain('`id` varchar(255) primary key');
    expect(types).toContain('`name` text not null');
    // The FK to it must match it exactly, or mysql calls the pair incompatible.
    expect(rooms).toContain('`type_id` varchar(255) not null');
    expect(rooms).toContain('`note` text');
    expect(stays).toContain('`room_number` integer');
  });

  it("types an FK to a HOST table with the host key's native type", async () => {
    const existing: ExistingTable[] = [
      { ref: 'jobs', columns: [{ ref: 'id', isPrimaryKey: true, dbType: 'bigint' }] },
    ];
    const [pg] = await sqlFor(DESIGN_STUDIO, ['jobs'], 'postgres', existing);
    expect(pg).toContain('"job_id" bigint not null');
    // A snapshot that carries no type keeps the historical id mapping.
    const [legacy] = await sqlFor(DESIGN_STUDIO, ['jobs'], 'postgres');
    expect(legacy).toContain('"job_id" varchar(36) not null');
  });

  it('follows a primary key that is itself a foreign key, and refuses a loop', async () => {
    const extension: RequiredTable[] = [
      ...HOTEL,
      {
        ref: 'room_notes',
        columns: [
          { ref: 'room_number', type: 'fk', role: 'pk', references: 'rooms' },
          { ref: 'body', type: 'text' },
        ],
      },
    ];
    const statements = await sqlFor(extension, [], 'postgres');
    expect(statements[3]).toContain('"room_number" integer primary key');

    const loop: RequiredTable[] = [
      { ref: 'a', columns: [{ ref: 'b_id', type: 'fk', role: 'pk', references: 'b' }] },
      { ref: 'b', columns: [{ ref: 'a_id', type: 'fk', role: 'pk', references: 'a' }] },
    ];
    await expect(sqlFor(loop, [], 'postgres')).rejects.toThrow(/references itself/);
  });

  it('creates every table IF NOT EXISTS, on every dialect', async () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const statements = await sqlFor(SHIPPING_DHL, [], dialect);
      expect(statements).toHaveLength(2);
      for (const statement of statements) {
        expect(statement).toContain('if not exists');
      }
    }
  });
});

// ── executed, against a real PostgreSQL ──────────────────────────────────────

/**
 * The leg that proves the postgres column types are real ones.
 *
 * Compiled SQL says what was emitted; only a server says whether `timestamptz`,
 * `jsonb` and `decimal(19,4)` are types it will accept in that combination —
 * and a typo in the map is indistinguishable from a correct entry until one
 * tries. Gated on `TEST_POSTGRES_URL` exactly like every other engine leg in
 * this repo; CI always sets it.
 *
 * Each run gets its own SCHEMA rather than its own database: the tables are
 * created unqualified, so a `search_path` is all the isolation vitest's
 * parallel workers need, and it drops in one statement.
 */
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(POSTGRES_URL === undefined)('applyInstall against a real PostgreSQL', () => {
  async function postgres(): Promise<{ db: AnyDb; done: () => Promise<void> }> {
    const require = createRequire(import.meta.url);
    const { Pool } = require('pg') as { Pool: new (config: unknown) => never };
    const schema = `adminium_addon_ddl_${randomBytes(4).toString('hex')}`;
    const pool = new Pool({ connectionString: POSTGRES_URL });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) }) as AnyDb;
    await sql.raw(`create schema ${schema}`).execute(db);
    await sql.raw(`set search_path to ${schema}`).execute(db);
    return {
      db,
      done: async () => {
        await sql.raw(`drop schema ${schema} cascade`).execute(db);
        await db.destroy();
      },
    };
  }

  it("creates shipping-dhl's tables, and postgres accepts every type in the map", async () => {
    const { db, done } = await postgres();
    try {
      const result = await applyInstall({
        plan: planFor(SHIPPING_DHL, []),
        tables: SHIPPING_DHL,
        db,
        dialect: 'postgres',
        existing: [],
      });
      expect(result.created).toEqual(['shipments', 'shipment_events']);

      // Read the types BACK, rather than trusting the statement that made them.
      const columns = await sql<{ column_name: string; data_type: string }>`
        select column_name, data_type from information_schema.columns
        where table_name = 'shipments'
      `.execute(db);
      const types = new Map(columns.rows.map((r) => [r.column_name, r.data_type]));
      // `character varying`, never `character` — bpchar blank-pads on write.
      expect(types.get('id')).toBe('character varying');
      expect(types.get('amount')).toBe('numeric');
      expect(types.get('created_at')).toBe('timestamp with time zone');

      // A money value that binary floating point cannot hold, round-tripped.
      await db
        .insertInto('shipments')
        .values({
          id: 's1',
          order_reference: 'SO-1',
          carrier: 'dhl',
          service: 'express',
          tracking: 'JD1',
          label_file: null,
          amount: '0.1',
          currency: 'EUR',
          collection_from: new Date('2026-08-29T08:00:00Z'),
          collection_to: new Date('2026-08-29T12:00:00Z'),
          status: 'booked',
          created_at: new Date('2026-08-29T07:00:00Z'),
        })
        .execute();
      const rows = await db.selectFrom('shipments').select('amount').execute();
      expect((rows[0] as { amount: string }).amount).toBe('0.1000');
    } finally {
      await done();
    }
  });

  it('creates a FK and a CHECK postgres actually enforces', async () => {
    const { db, done } = await postgres();
    try {
      await applyInstall({
        plan: planFor(SHIPPING_DHL, []),
        tables: SHIPPING_DHL,
        db,
        dialect: 'postgres',
        existing: [],
      });
      await expect(
        db
          .insertInto('shipment_events')
          .values({
            id: 'e1',
            shipment_id: 'no-such-shipment',
            at: new Date(),
            place: 'Leipzig',
            status: 'in-transit',
            description: 'scanned',
          })
          .execute(),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await done();
    }
  });

  it("creates an app's int- and text-keyed tables, whose FKs postgres used to refuse", async () => {
    // Was: `foreign key constraint "fk_stays_room_number" cannot be implemented`.
    const { db, done } = await postgres();
    try {
      const result = await applyInstall({
        plan: planFor(HOTEL, []),
        tables: HOTEL,
        db,
        dialect: 'postgres',
        existing: [],
      });
      expect(result.created).toEqual(['room_types', 'rooms', 'stays']);
      await db.insertInto('room_types').values({ id: 'dbl', name: 'Double' }).execute();
      await db.insertInto('rooms').values({ number: 101, type_id: 'dbl', note: null }).execute();
      await db
        .insertInto('stays')
        .values({ ref: 'S-1', type_id: 'dbl', room_number: 101 })
        .execute();
      await expect(
        db.insertInto('stays').values({ ref: 'S-2', type_id: 'dbl', room_number: 999 }).execute(),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await done();
    }
  });

  it('is re-runnable on postgres too', async () => {
    const { db, done } = await postgres();
    try {
      const input = {
        plan: planFor(SHIPPING_DHL, []),
        tables: SHIPPING_DHL,
        db,
        dialect: 'postgres' as const,
        existing: [],
      };
      await applyInstall(input);
      await expect(applyInstall(input)).resolves.toBeTruthy();
    } finally {
      await done();
    }
  });
});

// ── executed, against a real MySQL ───────────────────────────────────────────

/**
 * MySQL refuses two things SQLite accepts and this map once emitted: an FK
 * whose column type differs from its target ("are incompatible"), and a `text`
 * primary key ("used in key specification without a key length"). Gated on
 * `TEST_MYSQL_URL` like every other engine leg; CI always sets it.
 */
// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

describe.skipIf(MYSQL_URL === undefined)('applyInstall against a real MySQL', () => {
  it("creates an app's int- and text-keyed tables, and enforces their FKs", async () => {
    const mysql = await import('mysql2');
    const database = `adminium_addon_ddl_${randomBytes(4).toString('hex')}`;
    const admin = mysql.createPool({ uri: MYSQL_URL as string, connectionLimit: 1 }).promise();
    await admin.query(`CREATE DATABASE \`${database}\``);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${database}`;
    const db = new Kysely({
      dialect: new MysqlDialect({ pool: mysql.createPool({ uri: url.toString() }) }),
    }) as AnyDb;
    try {
      const result = await applyInstall({
        plan: planFor(HOTEL, []),
        tables: HOTEL,
        db,
        dialect: 'mysql',
        existing: [],
      });
      expect(result.created).toEqual(['room_types', 'rooms', 'stays']);
      await db.insertInto('room_types').values({ id: 'dbl', name: 'Double' }).execute();
      await db.insertInto('rooms').values({ number: 101, type_id: 'dbl', note: null }).execute();
      await expect(
        db.insertInto('stays').values({ ref: 'S-1', type_id: 'dbl', room_number: 999 }).execute(),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await db.destroy();
      await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });
});
