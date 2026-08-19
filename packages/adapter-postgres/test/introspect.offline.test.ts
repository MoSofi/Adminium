// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline introspection tests — the assembly pipeline driven through a
 * canned-rows executor (no server, no `pg` driver).
 *
 * `introspect.live.test.ts` proves the catalog SQL is *correct* against a real
 * Postgres. It cannot reach the paths this file covers, because they need rows
 * a healthy database will not produce on demand: a `pg_total_relation_size`
 * permission failure, a 300-label enum, an exhausted time budget, a foreign key
 * pointing outside the introspected set, a partition parent, a domain over an
 * enum. Those are exactly the branches that decide whether introspection
 * DEGRADES or CRASHES on a customer database, so they are asserted here from
 * fixed rows instead.
 *
 * Row shapes mirror the column aliases in `src/introspect.ts` verbatim.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdapterError, parseDatabaseModel } from '@adminium/engine/adapter';

import {
  interpretProbe,
  introspectPostgres,
  POSTGRES_CAPABILITIES,
  type CatalogRow,
} from '../src/introspect.js';

const CTX = { connectionId: 'conn-1', databaseName: 'shop' };

// ---------------------------------------------------------------------------
// Canned catalog
// ---------------------------------------------------------------------------

interface Catalog {
  schemas?: CatalogRow[];
  classes?: CatalogRow[];
  sizes?: CatalogRow[] | Error;
  columns?: CatalogRow[];
  constraints?: CatalogRow[];
  indexes?: CatalogRow[];
  enums?: CatalogRow[];
}

/**
 * Route a statement to its canned rows by a fragment unique to that query.
 * `SELECT n.nspname AS name` rather than `AS name`: the constraints query also
 * aliases `con.conname AS name`.
 */
function catalog(rows: Catalog): ((sql: string) => Promise<CatalogRow[]>) & { calls: string[] } {
  const calls: string[] = [];
  const exec = async (sql: string): Promise<CatalogRow[]> => {
    calls.push(sql);
    if (sql.includes('SELECT n.nspname AS name')) return rows.schemas ?? [{ name: 'public' }];
    if (sql.includes('AS relkind')) return rows.classes ?? [];
    if (sql.includes('pg_total_relation_size')) {
      if (rows.sizes instanceof Error) throw rows.sizes;
      return rows.sizes ?? [];
    }
    if (sql.includes('AS column_name')) return rows.columns ?? [];
    if (sql.includes('pg_catalog.pg_constraint')) return rows.constraints ?? [];
    if (sql.includes('pg_catalog.pg_index')) return rows.indexes ?? [];
    if (sql.includes('AS enum_name')) return rows.enums ?? [];
    throw new Error(`unrouted statement: ${sql.slice(0, 80)}`);
  };
  return Object.assign(exec, { calls });
}

/** A `pg_class` row with the healthy defaults; override what the test is about. */
function classRow(
  over: Partial<CatalogRow> & { rel_oid: number | null; table_name: string | null },
): CatalogRow {
  return {
    schema_name: 'public',
    relkind: 'r',
    is_partition: false,
    reltuples: 100,
    rls_enabled: false,
    rls_forced: false,
    comment: null,
    policy_count: 0,
    n_ins: null,
    n_upd: null,
    n_del: null,
    ...over,
  };
}

/** A `pg_attribute` row with the healthy defaults. */
function columnRow(
  over: Partial<CatalogRow> & {
    rel_oid: number | null;
    column_name: string | null;
    ordinal: number | null;
  },
): CatalogRow {
  return {
    db_type: 'text',
    not_null: false,
    identity: '',
    generated: '',
    default_expr: null,
    comment: null,
    typtype: 'b',
    typcategory: 'S',
    type_schema: 'pg_catalog',
    type_name: 'text',
    elem_db_type: null,
    elem_typtype: null,
    elem_type_schema: null,
    elem_type_name: null,
    base_db_type: null,
    base_typtype: null,
    base_type_schema: null,
    base_type_name: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('interpretProbe', () => {
  it('reads the boolean wire forms the two executors produce', () => {
    // The pg driver returns real booleans; the psql/json_agg harness returns 't'.
    const asBool = interpretProbe({
      server_version: '16.3',
      role_name: 'app',
      database_name: 'shop',
      in_recovery: false,
      default_read_only: 'off',
      can_create: true,
      ssl: true,
    });
    const asText = interpretProbe({
      server_version: '16.3',
      role_name: 'app',
      database_name: 'shop',
      in_recovery: 'f',
      default_read_only: 'off',
      can_create: 't',
      ssl: 't',
    });
    expect(asBool).toEqual(asText);
    expect(asBool.readOnly).toBe(false);
    expect(asBool.ssl).toBe(true);
  });

  it('treats a standby (in_recovery) as read-only even when the role can create', () => {
    const probe = interpretProbe({ in_recovery: true, can_create: true, default_read_only: 'off' });
    expect(probe.readOnly).toBe(true);
    expect(probe.canCreate).toBe(true);
  });

  it('treats default_transaction_read_only=on as read-only', () => {
    expect(interpretProbe({ can_create: true, default_read_only: 'on' }).readOnly).toBe(true);
  });

  it('treats a role that cannot CREATE as read-only', () => {
    expect(interpretProbe({ can_create: false, default_read_only: 'off' }).readOnly).toBe(true);
  });

  it('degrades an empty row to empty strings rather than "undefined"', () => {
    // A pooled endpoint can answer the probe with a partial row; stringifying
    // `undefined` would put the literal text "undefined" in the model.
    const probe = interpretProbe({});
    expect(probe.serverVersion).toBe('');
    expect(probe.roleName).toBe('');
    expect(probe.databaseName).toBe('');
    expect(probe.ssl).toBe(false);
    expect(probe.readOnly).toBe(true); // can_create absent → not creatable
  });
});

describe('introspectPostgres — schema selection', () => {
  it('drops the reserved adminium_demo schema from an unscoped run', async () => {
    const exec = catalog({ schemas: [{ name: 'adminium_demo' }, { name: 'public' }] });
    const model = await introspectPostgres(exec, CTX);
    expect(model.schemas).toEqual(['public']);
  });

  it('returns the reserved schema when it is asked for by name', async () => {
    const exec = catalog({ schemas: [{ name: 'adminium_demo' }, { name: 'public' }] });
    const model = await introspectPostgres(exec, CTX, { schemas: ['adminium_demo'] });
    expect(model.schemas).toEqual(['adminium_demo']);
    // An explicit selection narrows the catalog predicate to that literal.
    expect(exec.calls.some((c) => c.includes("n.nspname IN ('adminium_demo')"))).toBe(true);
  });

  it('silently drops a requested schema that does not exist on the server', async () => {
    const exec = catalog({ schemas: [{ name: 'public' }] });
    const model = await introspectPostgres(exec, CTX, { schemas: ['public', 'nope'] });
    expect(model.schemas).toEqual(['public']);
  });

  it('ignores a non-string schema name row', async () => {
    const exec = catalog({ schemas: [{ name: null }, { name: 'public' }] });
    const model = await introspectPostgres(exec, CTX);
    expect(model.schemas).toEqual(['public']);
  });

  it('emits a model the engine parser accepts', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'customers' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'id', ordinal: 1, db_type: 'bigint' })],
    });
    const model = await introspectPostgres(exec, CTX);
    // The IR contract, not just our own shape assertions.
    expect(() => parseDatabaseModel(model)).not.toThrow();
    expect(model.dialect).toBe('postgres');
    expect(model.name).toBe('shop');
    expect(model.source).toEqual({ kind: 'live', connectionId: 'conn-1' });
    expect(model.capabilities).toEqual(POSTGRES_CAPABILITIES);
    expect(model.stats.tableCount).toBe(1);
    expect(model.stats.columnCount).toBe(1);
  });
});

describe('introspectPostgres — degradation', () => {
  it('degrades a pg_total_relation_size permission failure to a warning', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'customers' })],
      sizes: Object.assign(new Error('permission denied for function pg_total_relation_size'), {
        code: '42501',
      }),
    });
    const model = await introspectPostgres(exec, CTX);

    // The whole point: a locked-down role still gets a usable model.
    expect(model.tables).toHaveLength(1);
    expect(model.tables[0]!.sizeBytes).toBeNull();
    expect(model.warnings.map((w) => w.code)).toContain('size-unavailable');
    const warning = model.warnings.find((w) => w.code === 'size-unavailable');
    expect(warning!.tableId).toBeNull();
  });

  it('does NOT swallow a timeout raised inside the size query', async () => {
    // A TIMEOUT means the whole budget is gone, not that sizes are unavailable —
    // degrading it would let introspection grind on past its deadline.
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'customers' })],
      sizes: new AdapterError('TIMEOUT', 'statement timeout'),
    });
    await expect(introspectPostgres(exec, CTX)).rejects.toThrow(AdapterError);
    await expect(introspectPostgres(exec, CTX)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('omits a VALUELESS enum instead of emitting an IR-invalid def', async () => {
    // `CREATE TYPE mood AS ENUM ()` is legal Postgres. The IR requires an
    // EnumDef to carry >= 1 value, so emitting the empty def made
    // parseDatabaseModel reject the ENTIRE model — one empty enum anywhere in
    // the database made it un-introspectable. Verified against a live server
    // before the fix.
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'people' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'mood',
          ordinal: 1,
          db_type: 'mood',
          typtype: 'e',
          type_schema: 'public',
          type_name: 'mood',
        }),
      ],
      enums: [
        { schema_name: 'public', enum_name: 'mood', labels: [] },
        { schema_name: 'public', enum_name: 'status', labels: ['new'] },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    expect(model.enums.map((e) => e.id)).toEqual(['public.status']);
    // ...and the column that referenced it must not keep a dangling ref.
    expect(model.tables[0]!.columns[0]!.enumRef).toBeNull();
    const warning = model.warnings.find((w) => w.code === 'enum-empty');
    expect(warning!.message).toContain('public.mood');
    // The whole point: the model is usable.
    expect(() => parseDatabaseModel(model)).not.toThrow();
  });

  it('caps a runaway enum at 256 values and says so', async () => {
    const labels = Array.from({ length: 300 }, (_, i) => `v${i}`);
    const exec = catalog({
      enums: [{ schema_name: 'public', enum_name: 'huge', labels }],
    });
    const model = await introspectPostgres(exec, CTX);

    const enumDef = model.enums.find((e) => e.id === 'public.huge');
    expect(enumDef!.values).toHaveLength(256);
    expect(enumDef!.values.at(-1)).toBe('v255');
    const warning = model.warnings.find((w) => w.code === 'enum-capped');
    expect(warning!.message).toContain('300');
  });

  it('reports hidden partitions once, not per partition', async () => {
    const exec = catalog({
      classes: [
        classRow({ rel_oid: 1, table_name: 'events' }),
        classRow({ rel_oid: 2, table_name: 'events_2024', is_partition: true }),
        classRow({ rel_oid: 3, table_name: 'events_2025', is_partition: true }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    expect(model.tables.map((t) => t.name)).toEqual(['events']);
    const hidden = model.warnings.filter((w) => w.code === 'partitions-hidden');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.message).toContain('2 partition(s)');
  });

  it('warns per foreign key whose target is outside the introspected set', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'tenant_id', ordinal: 1 })],
      constraints: [
        {
          name: 'orders_tenant_fk',
          contype: 'f',
          rel_oid: 1,
          ref_schema: 'billing',
          ref_table: 'tenants',
          columns: ['tenant_id'],
          ref_columns: ['id'],
          on_update: 'a',
          on_delete: 'a',
          definition: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    // No dangling relation, and the column mirror is not populated either.
    expect(model.relations).toHaveLength(0);
    expect(model.tables[0]!.columns[0]!.references).toBeNull();
    const warning = model.warnings.find((w) => w.code === 'fk-target-excluded');
    expect(warning!.tableId).toBe('public.orders');
    expect(warning!.message).toContain('billing.tenants');
  });
});

describe('introspectPostgres — time budget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts with TIMEOUT once the total budget is spent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-05T00:00:00.000Z'));
    // Each catalog statement "costs" 20s of the 30s budget, so the third one
    // is refused before it is sent — deterministic, no wall clock involved.
    const inner = catalog({ classes: [classRow({ rel_oid: 1, table_name: 'customers' })] });
    const exec = async (sql: string): Promise<CatalogRow[]> => {
      const rows = await inner(sql);
      vi.advanceTimersByTime(20_000);
      return rows;
    };

    const failure = await introspectPostgres(exec, CTX, { timeoutMs: 30_000 }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AdapterError);
    expect((failure as AdapterError).code).toBe('TIMEOUT');
    expect((failure as AdapterError).detail).toBe('timeoutMs=30000');
    expect((failure as AdapterError).hint).toMatch(/timeoutMs|narrow/);
    // It died at the THIRD statement: two ran, the third never reached exec.
    expect(inner.calls).toHaveLength(2);
  });

  it('completes within budget and reports a duration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-05T00:00:00.000Z'));
    const inner = catalog({ classes: [classRow({ rel_oid: 1, table_name: 'customers' })] });
    const exec = async (sql: string): Promise<CatalogRow[]> => {
      const rows = await inner(sql);
      vi.advanceTimersByTime(1_000);
      return rows;
    };

    const model = await introspectPostgres(exec, CTX, { timeoutMs: 30_000 });

    expect(model.stats.durationMs).toBe(7_000); // seven catalog statements
    expect(model.introspectedAt).toBe('2024-03-05T00:00:07.000Z');
  });
});

describe('introspectPostgres — table shape', () => {
  it('classifies relkind into table / view / materialized-view', async () => {
    const exec = catalog({
      classes: [
        classRow({ rel_oid: 1, table_name: 'a_table', relkind: 'r' }),
        classRow({ rel_oid: 2, table_name: 'b_view', relkind: 'v' }),
        classRow({ rel_oid: 3, table_name: 'c_matview', relkind: 'm' }),
        classRow({ rel_oid: 4, table_name: 'd_partitioned', relkind: 'p' }),
        classRow({ rel_oid: 5, table_name: 'e_unknown', relkind: null }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    expect(model.tables.map((t) => [t.name, t.kind])).toEqual([
      ['a_table', 'table'],
      ['b_view', 'view'],
      ['c_matview', 'materialized-view'],
      ['d_partitioned', 'table'],
      ['e_unknown', 'table'], // relkind absent → default 'r'
    ]);
  });

  it('never puts a row estimate on a view', async () => {
    const exec = catalog({
      classes: [
        classRow({ rel_oid: 1, table_name: 'v', relkind: 'v', reltuples: 500 }),
        classRow({ rel_oid: 2, table_name: 't', relkind: 'r', reltuples: 500 }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables.find((t) => t.name === 'v')!.rowCountEstimate).toBeNull();
    expect(model.tables.find((t) => t.name === 't')!.rowCountEstimate).toBe(500);
  });

  it.each([
    ['never analyzed (reltuples -1)', -1, null],
    ['non-finite reltuples', 'NaN', null],
    ['absent reltuples', null, null],
    ['fractional estimate is rounded', 12.6, 13],
  ] as const)('row estimate: %s', async (_label, reltuples, expected) => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 't', reltuples })],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables[0]!.rowCountEstimate).toBe(expected);
    expect(model.tables[0]!.rowCountExact).toBe(false);
  });

  it('omits row estimates entirely when collectRowEstimates is off', async () => {
    const exec = catalog({ classes: [classRow({ rel_oid: 1, table_name: 't', reltuples: 500 })] });
    const model = await introspectPostgres(exec, CTX, { collectRowEstimates: false });
    expect(model.tables[0]!.rowCountEstimate).toBeNull();
  });

  it('collects activity only for base tables, defaulting missing counters to 0', async () => {
    const exec = catalog({
      classes: [
        classRow({ rel_oid: 1, table_name: 't', n_ins: 10, n_upd: null, n_del: 3 }),
        classRow({ rel_oid: 2, table_name: 'm', relkind: 'm', n_ins: 10, n_upd: 1, n_del: 1 }),
        classRow({ rel_oid: 3, table_name: 'q', n_ins: null }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    expect(model.tables.find((t) => t.name === 't')!.activity).toEqual({
      inserts: 10,
      updates: 0,
      deletes: 3,
    });
    // A materialized view has no pg_stat_user_tables row to speak of.
    expect(model.tables.find((t) => t.name === 'm')!.activity).toBeNull();
    // Never-touched table: no counters at all.
    expect(model.tables.find((t) => t.name === 'q')!.activity).toBeNull();
  });

  it('omits activity entirely when collectActivityStats is off', async () => {
    const exec = catalog({ classes: [classRow({ rel_oid: 1, table_name: 't', n_ins: 10 })] });
    const model = await introspectPostgres(exec, CTX, { collectActivityStats: false });
    expect(model.tables[0]!.activity).toBeNull();
  });

  it('carries RLS state and flags migration bookkeeping as system tables', async () => {
    const exec = catalog({
      classes: [
        classRow({
          rel_oid: 1,
          table_name: 'documents',
          rls_enabled: 't',
          rls_forced: true,
          policy_count: 3,
        }),
        classRow({ rel_oid: 2, table_name: 'knex_migrations' }),
        classRow({ rel_oid: 3, table_name: 'adminium_connections' }),
        classRow({ rel_oid: 4, table_name: 'schema_migrations' }),
        classRow({ rel_oid: 5, table_name: 'customers' }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const documents = model.tables.find((t) => t.name === 'documents')!;
    expect(documents.rls).toEqual({ enabled: true, forced: true, policyCount: 3 });
    expect(model.tables.filter((t) => t.system).map((t) => t.name).sort()).toEqual([
      'adminium_connections',
      'knex_migrations',
      'schema_migrations',
    ]);
    expect(model.tables.find((t) => t.name === 'customers')!.system).toBe(false);
    // Defaults when the catalog columns are absent.
    expect(model.tables.find((t) => t.name === 'customers')!.rls).toEqual({
      enabled: false,
      forced: false,
      policyCount: 0,
    });
  });

  it('applies tableFilter after enumeration and drops the filtered rows entirely', async () => {
    const exec = catalog({
      classes: [
        classRow({ rel_oid: 1, table_name: 'keep' }),
        classRow({ rel_oid: 2, table_name: 'drop' }),
      ],
      columns: [columnRow({ rel_oid: 2, column_name: 'x', ordinal: 1 })],
    });
    const model = await introspectPostgres(exec, CTX, {
      tableFilter: ({ name }) => name === 'keep',
    });

    expect(model.tables.map((t) => t.name)).toEqual(['keep']);
    // Columns belonging to a filtered-out table are dropped, not orphaned.
    expect(model.stats.columnCount).toBe(0);
  });

  it('sorts tables by id and columns by ordinal', async () => {
    const exec = catalog({
      classes: [
        classRow({ rel_oid: 1, table_name: 'zebra' }),
        classRow({ rel_oid: 2, table_name: 'alpha' }),
      ],
      columns: [
        columnRow({ rel_oid: 1, column_name: 'second', ordinal: 2 }),
        columnRow({ rel_oid: 1, column_name: 'first', ordinal: 1 }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables.map((t) => t.name)).toEqual(['alpha', 'zebra']);
    expect(model.tables.find((t) => t.name === 'zebra')!.columns.map((c) => c.name)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('introspectPostgres — column types', () => {
  it('maps a native enum column to its enum def', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'status',
          ordinal: 1,
          db_type: 'order_status',
          typtype: 'e',
          type_schema: 'public',
          type_name: 'order_status',
        }),
      ],
      enums: [{ schema_name: 'public', enum_name: 'order_status', labels: ['new', 'paid'] }],
    });
    const model = await introspectPostgres(exec, CTX);

    const column = model.tables[0]!.columns[0]!;
    expect(column.logicalType).toBe('enum');
    expect(column.enumRef).toBe('public.order_status');
    expect(column.dbType).toBe('order_status'); // verbatim db type preserved
    expect(model.enums.map((e) => e.id)).toContain('public.order_status');
  });

  it('takes a domain column logical type from its base type', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'people' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'email',
          ordinal: 1,
          db_type: 'email_address',
          typtype: 'd',
          base_db_type: 'character varying(320)',
          base_typtype: 'b',
        }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const column = model.tables[0]!.columns[0]!;
    expect(column.logicalType).toBe('varchar');
    expect(column.maxLength).toBe(320);
    // 05 §4.1: the domain NAME stays as dbType so the UI can show it.
    expect(column.dbType).toBe('email_address');
    expect(column.enumRef).toBeNull();
  });

  it('resolves a domain built over an enum to the enum', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'status',
          ordinal: 1,
          db_type: 'order_status_domain',
          typtype: 'd',
          base_db_type: 'order_status',
          base_typtype: 'e',
          base_type_schema: 'public',
          base_type_name: 'order_status',
        }),
      ],
      enums: [{ schema_name: 'public', enum_name: 'order_status', labels: ['new'] }],
    });
    const model = await introspectPostgres(exec, CTX);

    const column = model.tables[0]!.columns[0]!;
    expect(column.logicalType).toBe('enum');
    expect(column.enumRef).toBe('public.order_status');
  });

  it('falls back to the column db type when a domain has no base type row', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'people' })],
      columns: [
        columnRow({ rel_oid: 1, column_name: 'n', ordinal: 1, db_type: 'integer', typtype: 'd' }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables[0]!.columns[0]!.logicalType).toBe('integer');
  });

  it('maps an array column to its ELEMENT logical type and flags isArray', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'posts' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'tag_ids',
          ordinal: 1,
          db_type: 'integer[]',
          typcategory: 'A',
          elem_db_type: 'integer',
          elem_typtype: 'b',
        }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const column = model.tables[0]!.columns[0]!;
    expect(column.isArray).toBe(true);
    expect(column.logicalType).toBe('integer');
    expect(column.dbType).toBe('integer[]');
  });

  it('maps an array OF enum to the enum def', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'posts' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'states',
          ordinal: 1,
          db_type: 'order_status[]',
          typcategory: 'A',
          elem_typtype: 'e',
          elem_type_schema: 'public',
          elem_type_name: 'order_status',
        }),
      ],
      enums: [{ schema_name: 'public', enum_name: 'order_status', labels: ['new'] }],
    });
    const model = await introspectPostgres(exec, CTX);

    const column = model.tables[0]!.columns[0]!;
    expect(column.isArray).toBe(true);
    expect(column.logicalType).toBe('enum');
    expect(column.enumRef).toBe('public.order_status');
  });

  it('falls back to the column db type when an array has no element row', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'posts' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'raw',
          ordinal: 1,
          db_type: 'text',
          typcategory: 'A',
        }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables[0]!.columns[0]!.logicalType).toBe('text');
  });

  it('nulls the default of a stored generated column and marks it generated', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'people' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'full_name',
          ordinal: 1,
          generated: 's',
          default_expr: "((first || ' '::text) || last)",
        }),
        columnRow({
          rel_oid: 1,
          column_name: 'created_at',
          ordinal: 2,
          db_type: 'timestamp with time zone',
          default_expr: 'now()',
        }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const generated = model.tables[0]!.columns[0]!;
    expect(generated.isGenerated).toBe(true);
    expect(generated.default).toBeNull();
    const created = model.tables[0]!.columns[1]!;
    expect(created.isGenerated).toBe(false);
    expect(created.default).not.toBeNull();
  });

  it('reads not_null in both wire forms and degrades a nameless column', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 't' })],
      columns: [
        columnRow({ rel_oid: 1, column_name: 'a', ordinal: 1, not_null: true }),
        columnRow({ rel_oid: 1, column_name: 'b', ordinal: 2, not_null: 't' }),
        columnRow({ rel_oid: 1, column_name: 'c', ordinal: 3, not_null: false }),
        columnRow({ rel_oid: 1, column_name: null, ordinal: null }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const columns = model.tables[0]!.columns;
    expect(columns.find((c) => c.name === 'a')!.nullable).toBe(false);
    expect(columns.find((c) => c.name === 'b')!.nullable).toBe(false);
    expect(columns.find((c) => c.name === 'c')!.nullable).toBe(true);
    expect(columns.find((c) => c.name === '')!.ordinal).toBe(0);
  });

  it('drops a column whose rel_oid matches no introspected table', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 't' })],
      columns: [
        columnRow({ rel_oid: 1, column_name: 'kept', ordinal: 1 }),
        columnRow({ rel_oid: 99, column_name: 'orphan', ordinal: 1 }),
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables[0]!.columns.map((c) => c.name)).toEqual(['kept']);
  });
});

describe('introspectPostgres — constraints and relations', () => {
  const twoTables = [
    classRow({ rel_oid: 1, table_name: 'customers' }),
    classRow({ rel_oid: 2, table_name: 'orders' }),
  ];
  const twoTableColumns = [
    columnRow({ rel_oid: 1, column_name: 'id', ordinal: 1, db_type: 'bigint' }),
    columnRow({ rel_oid: 1, column_name: 'email', ordinal: 2 }),
    columnRow({ rel_oid: 2, column_name: 'id', ordinal: 1, db_type: 'bigint' }),
    columnRow({ rel_oid: 2, column_name: 'customer_id', ordinal: 2, db_type: 'bigint' }),
  ];

  it('marks primary-key and unique columns and records the constraints', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [
        { name: 'customers_pkey', contype: 'p', rel_oid: 1, columns: ['id'] },
        { name: 'customers_email_key', contype: 'u', rel_oid: 1, columns: ['email'] },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const customers = model.tables.find((t) => t.name === 'customers')!;
    expect(customers.primaryKey).toEqual(['id']);
    expect(customers.columns.find((c) => c.name === 'id')!.isPrimaryKey).toBe(true);
    expect(customers.columns.find((c) => c.name === 'email')!.isPrimaryKey).toBe(false);
    expect(customers.uniques).toEqual([{ name: 'customers_email_key', columns: ['email'] }]);
  });

  it('accepts the pg-driver array literal as well as a real JSON array', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [
        // `{a,b}` is what pg returns for name[] with no type parser registered.
        { name: 'customers_pkey', contype: 'p', rel_oid: 1, columns: '{id,email}' },
        { name: 'orders_empty', contype: 'u', rel_oid: 2, columns: '{}' },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    expect(model.tables.find((t) => t.name === 'customers')!.primaryKey).toEqual(['id', 'email']);
    expect(model.tables.find((t) => t.name === 'orders')!.uniques[0]!.columns).toEqual([]);
  });

  it('falls back to an empty column list for an unparseable array value', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [{ name: 'weird', contype: 'u', rel_oid: 1, columns: 42 }],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables.find((t) => t.name === 'customers')!.uniques[0]!.columns).toEqual([]);
  });

  it('synthesizes an enum from a CHECK (col IN (...)) and links the column', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'customers' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'tier', ordinal: 1 })],
      constraints: [
        {
          name: 'customers_tier_check',
          contype: 'c',
          rel_oid: 1,
          columns: ['tier'],
          definition: "CHECK (((tier)::text = ANY ((ARRAY['free'::text, 'pro'::text]))))",
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const synthesized = model.enums.find((e) => e.id === 'public.customers.tier')!;
    expect(synthesized.source).toBe('check');
    expect(synthesized.values).toEqual(['free', 'pro']);
    expect(model.tables[0]!.columns[0]!.enumRef).toBe('public.customers.tier');
    // The check itself is still recorded, with the CHECK(( )) wrapper stripped.
    expect(model.tables[0]!.checks[0]!.name).toBe('customers_tier_check');
    expect(model.tables[0]!.checks[0]!.expression).toMatch(/^\(tier\)::text = ANY/);
  });

  it('does not synthesize an enum for a CHECK on an unknown column', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'customers' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'tier', ordinal: 1 })],
      constraints: [
        {
          name: 'ck',
          contype: 'c',
          rel_oid: 1,
          columns: [],
          definition: "CHECK ((ghost IN ('a', 'b')))",
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.enums).toHaveLength(0);
    expect(model.tables[0]!.checks).toHaveLength(1);
  });

  it('records a non-enum CHECK without inventing an enum', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'total', ordinal: 1, db_type: 'numeric' })],
      constraints: [
        {
          name: 'orders_total_positive',
          contype: 'c',
          rel_oid: 1,
          columns: ['total'],
          definition: 'CHECK ((total > (0)::numeric))',
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.enums).toHaveLength(0);
    expect(model.tables[0]!.checks[0]!.expression).toBe('total > (0)::numeric');
  });

  it('leaves a native enumRef in place rather than overwriting it with a CHECK enum', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'status',
          ordinal: 1,
          typtype: 'e',
          type_schema: 'public',
          type_name: 'order_status',
        }),
      ],
      constraints: [
        {
          name: 'ck',
          contype: 'c',
          rel_oid: 1,
          columns: ['status'],
          definition: "CHECK ((status IN ('new', 'paid')))",
        },
      ],
      enums: [{ schema_name: 'public', enum_name: 'order_status', labels: ['new', 'paid'] }],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables[0]!.columns[0]!.enumRef).toBe('public.order_status');
  });

  it('builds a declared FK relation with actions and a per-column mirror', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [
        {
          name: 'orders_customer_fk',
          contype: 'f',
          rel_oid: 2,
          ref_schema: 'public',
          ref_table: 'customers',
          columns: ['customer_id'],
          ref_columns: ['id'],
          on_update: 'c',
          on_delete: 'n',
          definition: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    expect(model.relations).toHaveLength(1);
    const relation = model.relations[0]!;
    expect(relation.kind).toBe('declared-fk');
    expect(relation.cardinality).toBe('one-to-many');
    expect(relation.from).toEqual({ tableId: 'public.orders', columns: ['customer_id'] });
    expect(relation.to).toEqual({ tableId: 'public.customers', columns: ['id'] });
    expect(relation.onUpdate).toBe('cascade');
    expect(relation.onDelete).toBe('set-null');
    expect(relation.selfReferential).toBe(false);
    expect(relation.confidence).toBe(1);

    const orders = model.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.find((c) => c.name === 'customer_id')!.references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
  });

  it('maps an unrecognized FK action code to null rather than guessing', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [
        {
          name: 'fk',
          contype: 'f',
          rel_oid: 2,
          ref_schema: 'public',
          ref_table: 'customers',
          columns: ['customer_id'],
          ref_columns: ['id'],
          on_update: 'z',
          on_delete: null,
          definition: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.relations[0]!.onUpdate).toBeNull();
    expect(model.relations[0]!.onDelete).toBeNull();
  });

  it('flags a self-referential FK', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'employees' })],
      columns: [
        columnRow({ rel_oid: 1, column_name: 'id', ordinal: 1, db_type: 'bigint' }),
        columnRow({ rel_oid: 1, column_name: 'manager_id', ordinal: 2, db_type: 'bigint' }),
      ],
      constraints: [
        {
          name: 'employees_manager_fk',
          contype: 'f',
          rel_oid: 1,
          ref_schema: 'public',
          ref_table: 'employees',
          columns: ['manager_id'],
          ref_columns: ['id'],
          on_update: 'a',
          on_delete: 'a',
          definition: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.relations[0]!.selfReferential).toBe(true);
    expect(model.relations[0]!.onDelete).toBe('no-action');
  });

  it('does not overwrite an existing column reference with a second FK', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [
        {
          name: 'a_first_fk',
          contype: 'f',
          rel_oid: 2,
          ref_schema: 'public',
          ref_table: 'customers',
          columns: ['customer_id'],
          ref_columns: ['id'],
          definition: null,
        },
        {
          name: 'b_second_fk',
          contype: 'f',
          rel_oid: 2,
          ref_schema: 'public',
          ref_table: 'orders',
          columns: ['customer_id'],
          ref_columns: ['id'],
          definition: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    // Both relations exist, but the column mirror keeps the first winner.
    expect(model.relations).toHaveLength(2);
    const orders = model.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.find((c) => c.name === 'customer_id')!.references!.tableId).toBe(
      'public.customers',
    );
  });

  it('leaves the mirror alone when the FK has fewer referenced columns than local ones', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [
        {
          name: 'malformed_fk',
          contype: 'f',
          rel_oid: 2,
          ref_schema: 'public',
          ref_table: 'customers',
          columns: ['customer_id', 'id'],
          ref_columns: ['id'],
          definition: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    const orders = model.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.find((c) => c.name === 'customer_id')!.references).not.toBeNull();
    expect(orders.columns.find((c) => c.name === 'id')!.references).toBeNull();
  });

  it('drops a constraint whose rel_oid matches no introspected table', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [{ name: 'orphan', contype: 'p', rel_oid: 99, columns: ['id'] }],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables.every((t) => t.primaryKey.length === 0)).toBe(true);
  });

  it('ignores a constraint type outside the p/u/f/c set', async () => {
    const exec = catalog({
      classes: twoTables,
      columns: twoTableColumns,
      constraints: [{ name: 'trg', contype: 't', rel_oid: 1, columns: ['id'] }],
    });
    const model = await introspectPostgres(exec, CTX);
    const customers = model.tables.find((t) => t.name === 'customers')!;
    expect(customers.primaryKey).toEqual([]);
    expect(customers.uniques).toEqual([]);
    expect(customers.checks).toEqual([]);
  });
});

describe('introspectPostgres — indexes and cardinality', () => {
  const tables = [
    classRow({ rel_oid: 1, table_name: 'customers' }),
    classRow({ rel_oid: 2, table_name: 'profiles' }),
  ];
  const columns = [
    columnRow({ rel_oid: 1, column_name: 'id', ordinal: 1, db_type: 'bigint' }),
    columnRow({ rel_oid: 2, column_name: 'id', ordinal: 1, db_type: 'bigint' }),
    columnRow({ rel_oid: 2, column_name: 'customer_id', ordinal: 2, db_type: 'bigint' }),
  ];
  const fk = {
    name: 'profiles_customer_fk',
    contype: 'f',
    rel_oid: 2,
    ref_schema: 'public',
    ref_table: 'customers',
    columns: ['customer_id'],
    ref_columns: ['id'],
    definition: null,
  };

  it('marks isUnique from a single-column unique index only', async () => {
    const exec = catalog({
      classes: tables,
      columns,
      indexes: [
        {
          rel_oid: 2,
          index_name: 'profiles_customer_idx',
          is_unique: true,
          is_primary: false,
          method: 'btree',
          is_partial: false,
          columns: ['customer_id'],
          expression: null,
        },
        {
          rel_oid: 2,
          index_name: 'profiles_partial_idx',
          is_unique: true,
          is_primary: false,
          method: 'btree',
          is_partial: true,
          columns: ['id'],
          expression: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);

    const profiles = model.tables.find((t) => t.name === 'profiles')!;
    expect(profiles.columns.find((c) => c.name === 'customer_id')!.isUnique).toBe(true);
    // A PARTIAL unique index does not make the column unique — it only
    // constrains the subset matching its predicate.
    expect(profiles.columns.find((c) => c.name === 'id')!.isUnique).toBe(false);
    expect(profiles.indexes.map((i) => i.name)).toEqual([
      'profiles_customer_idx',
      'profiles_partial_idx',
    ]);
  });

  it('does not mark isUnique from an expression or multi-column index', async () => {
    const exec = catalog({
      classes: tables,
      columns,
      indexes: [
        {
          rel_oid: 2,
          index_name: 'lower_idx',
          is_unique: true,
          is_partial: false,
          columns: ['customer_id'],
          expression: 'lower(customer_id)',
          method: 'btree',
        },
        {
          rel_oid: 2,
          index_name: 'pair_idx',
          is_unique: true,
          is_partial: false,
          columns: ['id', 'customer_id'],
          expression: null,
          method: 'btree',
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    const profiles = model.tables.find((t) => t.name === 'profiles')!;
    expect(profiles.columns.every((c) => !c.isUnique)).toBe(true);
  });

  it('refines an FK to one-to-one when a unique index covers exactly its columns', async () => {
    const exec = catalog({
      classes: tables,
      columns,
      constraints: [fk],
      indexes: [
        {
          rel_oid: 2,
          index_name: 'profiles_customer_key',
          is_unique: true,
          is_primary: false,
          method: 'btree',
          is_partial: false,
          columns: ['customer_id'],
          expression: null,
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.relations[0]!.cardinality).toBe('one-to-one');
  });

  it('refines to one-to-one from a primary key too', async () => {
    const exec = catalog({
      classes: tables,
      columns,
      constraints: [fk, { name: 'profiles_pkey', contype: 'p', rel_oid: 2, columns: ['customer_id'] }],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.relations[0]!.cardinality).toBe('one-to-one');
  });

  it('refines to one-to-one from a unique CONSTRAINT, order-insensitively', async () => {
    const exec = catalog({
      classes: tables,
      columns: [
        ...columns,
        columnRow({ rel_oid: 2, column_name: 'tenant_id', ordinal: 3, db_type: 'bigint' }),
      ],
      constraints: [
        { ...fk, columns: ['customer_id', 'tenant_id'], ref_columns: ['id', 'id'] },
        {
          name: 'profiles_pair_key',
          contype: 'u',
          rel_oid: 2,
          // Reversed relative to the FK — the comparison sorts both sides.
          columns: ['tenant_id', 'customer_id'],
        },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.relations[0]!.cardinality).toBe('one-to-one');
  });

  it('stays one-to-many when the unique key is only a prefix of the FK', async () => {
    const exec = catalog({
      classes: tables,
      columns: [
        ...columns,
        columnRow({ rel_oid: 2, column_name: 'tenant_id', ordinal: 3, db_type: 'bigint' }),
      ],
      constraints: [
        { ...fk, columns: ['customer_id', 'tenant_id'], ref_columns: ['id', 'id'] },
        { name: 'profiles_one_key', contype: 'u', rel_oid: 2, columns: ['customer_id'] },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.relations[0]!.cardinality).toBe('one-to-many');
  });

  it('does not treat an empty primary key as covering the FK', async () => {
    // `[].sort().join()` is '' — so is a zero-column key set. Without the
    // length > 0 guard every FK on a PK-less table would become one-to-one.
    const exec = catalog({ classes: tables, columns, constraints: [fk] });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables.find((t) => t.name === 'profiles')!.primaryKey).toEqual([]);
    expect(model.relations[0]!.cardinality).toBe('one-to-many');
  });

  it('drops an index whose rel_oid matches no introspected table', async () => {
    const exec = catalog({
      classes: tables,
      columns,
      indexes: [{ rel_oid: 99, index_name: 'orphan_idx', is_unique: false, columns: ['x'] }],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.tables.every((t) => t.indexes.length === 0)).toBe(true);
  });

  it('degrades a nameless index row instead of dropping it', async () => {
    const exec = catalog({
      classes: tables,
      columns,
      indexes: [{ rel_oid: 2, index_name: null, is_unique: false, columns: null, expression: null }],
    });
    const model = await introspectPostgres(exec, CTX);
    const index = model.tables.find((t) => t.name === 'profiles')!.indexes[0]!;
    expect(index.name).toBe('');
    expect(index.columns).toEqual([]);
    expect(index.method).toBeNull();
    expect(index.primary).toBe(false);
    expect(index.partial).toBe(false);
  });
});

describe('introspectPostgres — enum inclusion', () => {
  it('keeps an enum from another schema when a column references it', async () => {
    const exec = catalog({
      schemas: [{ name: 'public' }, { name: 'shared' }],
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [
        columnRow({
          rel_oid: 1,
          column_name: 'status',
          ordinal: 1,
          typtype: 'e',
          type_schema: 'shared',
          type_name: 'order_status',
        }),
      ],
      enums: [
        { schema_name: 'shared', enum_name: 'order_status', labels: ['new'] },
        { schema_name: 'other', enum_name: 'unused', labels: ['x'] },
      ],
    });
    const model = await introspectPostgres(exec, CTX, { schemas: ['public'] });

    // Referenced → kept even though 'shared' is not in the selection.
    expect(model.enums.map((e) => e.id)).toEqual(['shared.order_status']);
  });

  it('keeps an unreferenced enum that lives in an included schema', async () => {
    const exec = catalog({
      enums: [
        { schema_name: 'public', enum_name: 'unused_here', labels: ['a'] },
        { schema_name: 'elsewhere', enum_name: 'unused_there', labels: ['b'] },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.enums.map((e) => e.id)).toEqual(['public.unused_here']);
  });

  it('degrades an enum row with no schema/name and parses the {a,b} label literal', async () => {
    const exec = catalog({
      schemas: [{ name: 'public' }, { name: '' }],
      enums: [
        { schema_name: null, enum_name: null, labels: '{}' },
        { schema_name: 'public', enum_name: 'grade', labels: '{a,"b c"}' },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.enums.find((e) => e.id === 'public.grade')!.values).toEqual(['a', 'b c']);
  });

  it('sorts enums by id', async () => {
    const exec = catalog({
      enums: [
        { schema_name: 'public', enum_name: 'zeta', labels: ['a'] },
        { schema_name: 'public', enum_name: 'alpha', labels: ['a'] },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    expect(model.enums.map((e) => e.id)).toEqual(['public.alpha', 'public.zeta']);
  });
});

describe('introspectPostgres — degrades malformed catalog rows', () => {
  /**
   * Not hypothetical: a role without privileges on a referenced object sees
   * NULLs come back from the outer joins in these queries. Introspection must
   * produce a usable (if thinner) model rather than throw, because throwing
   * means the user cannot connect at all.
   */
  it('survives a class/size/column/index row with every optional field NULL', async () => {
    const exec = catalog({
      classes: [
        {
          schema_name: null,
          table_name: null,
          rel_oid: null,
          relkind: null,
          is_partition: null,
          reltuples: null,
          rls_enabled: null,
          rls_forced: null,
          comment: null,
          policy_count: null,
          n_ins: 5,
          n_upd: null,
          n_del: null,
        },
      ],
      sizes: [{ rel_oid: null, size_bytes: null }],
      columns: [
        {
          rel_oid: null,
          column_name: null,
          ordinal: null,
          db_type: null,
          not_null: null,
          identity: null,
          generated: null,
          default_expr: null,
          comment: null,
          typtype: null,
          typcategory: null,
        },
      ],
      indexes: [
        { rel_oid: null, index_name: null, is_unique: null, columns: null, expression: null },
      ],
    });

    const model = await introspectPostgres(exec, CTX);

    // NOTE: the property asserted here is CRASH-SAFETY, not IR validity. The
    // `?? ''` fallbacks keep assembly from throwing, but an empty schema/table/
    // column/index name does NOT satisfy the IR (each is `min(1)`), so this
    // model would be rejected by `parseDatabaseModel`. That is a latent
    // inconsistency rather than a live bug: `pg_namespace.nspname`,
    // `pg_class.relname` and `pg_attribute.attname` are all NOT NULL, so a real
    // Postgres cannot produce these rows. Asserting the current output as
    // "correct" would be wrong, so it is left unasserted and recorded instead.
    const table = model.tables[0]!;
    expect(table.id).toBe('.');
    expect(table.kind).toBe('table'); // null relkind → the 'r' default
    expect(table.rowCountEstimate).toBeNull();
    expect(table.sizeBytes).toBe(0); // null size → 0, not "unknown"
    expect(table.rls).toEqual({ enabled: false, forced: false, policyCount: 0 });
    // A missing counter reads as 0 so the row is still shaped correctly.
    expect(table.activity).toEqual({ inserts: 5, updates: 0, deletes: 0 });
    const column = table.columns[0]!;
    expect(column.name).toBe('');
    expect(column.dbType).toBe('unknown');
    expect(column.logicalType).toBe('unknown');
    expect(column.nullable).toBe(true);
  });

  it('survives constraint rows with NULL identity fields', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 'orders' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'total', ordinal: 1 })],
      constraints: [
        // A CHECK whose definition could not be read.
        { name: null, contype: 'c', rel_oid: 1, columns: null, definition: null },
        // An FK whose target could not be resolved at all.
        {
          name: null,
          contype: 'f',
          rel_oid: 1,
          ref_schema: null,
          ref_table: null,
          columns: null,
          ref_columns: null,
          definition: null,
        },
      ],
    });

    const model = await introspectPostgres(exec, CTX);

    // Crash-safety again: `pg_get_constraintdef` returning NULL yields an empty
    // check expression, which the IR's `min(1)` would reject. Unreachable from
    // a real catalog (the function is NULL only for a nonexistent OID).
    expect(model.tables[0]!.checks[0]!.expression).toBe('');
    // The unresolvable FK target "." is outside the set → warned, not emitted.
    expect(model.relations).toHaveLength(0);
    const warning = model.warnings.find((w) => w.code === 'fk-target-excluded');
    expect(warning!.message).toContain('""');
  });

  it('never emits an enumRef the model does not carry a def for', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 't' })],
      columns: [
        columnRow({ rel_oid: 1, column_name: 'a', ordinal: 1, typtype: 'e', type_schema: null, type_name: null }),
        columnRow({
          rel_oid: 1,
          column_name: 'b',
          ordinal: 2,
          typtype: 'd',
          base_db_type: 'x',
          base_typtype: 'e',
          base_type_schema: null,
          base_type_name: null,
        }),
        columnRow({
          rel_oid: 1,
          column_name: 'c',
          ordinal: 3,
          typcategory: 'A',
          elem_typtype: 'e',
          elem_type_schema: null,
          elem_type_name: null,
        }),
      ],
    });

    const model = await introspectPostgres(exec, CTX);

    // No enum row came back, so there is no def to point at. A dangling
    // `enumRef` is rejected outright by the IR's cross-reference check
    // ("unknown enum"), which would fail the whole model — so all three
    // shapes (native, domain-over-enum, array-of-enum) must resolve to null.
    for (const column of model.tables[0]!.columns) {
      expect(column.logicalType).toBe('enum');
      expect(column.enumRef).toBeNull();
    }
    expect(() => parseDatabaseModel(model)).not.toThrow();
  });

  it('keeps a stable order when two sort keys are equal', async () => {
    const exec = catalog({
      classes: [classRow({ rel_oid: 1, table_name: 't' })],
      columns: [columnRow({ rel_oid: 1, column_name: 'a', ordinal: 1 })],
      indexes: [
        { rel_oid: 1, index_name: 'dup', is_unique: false, columns: ['a'], expression: null, method: 'btree' },
        { rel_oid: 1, index_name: 'dup', is_unique: false, columns: [], expression: null, method: 'hash' },
      ],
    });
    const model = await introspectPostgres(exec, CTX);
    // Both survive the sort — a comparator returning nonzero for equal keys
    // would be free to drop or duplicate one.
    expect(model.tables[0]!.indexes.map((i) => i.method)).toEqual(['btree', 'hash']);
  });
});
