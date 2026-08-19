// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline introspection tests — the full assembly pipeline driven through a
 * canned-rows executor (no server, no driver), plus the SQL-text contract:
 * every statement in the fixed set references `information_schema`
 * exclusively (the "schema only" invariant, 05 §10) and is scoped to the
 * connected database. The live suite (adapter.live.test.ts) re-verifies the
 * same behavior against a real MySQL when TEST_MYSQL_URL is set.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdapterError, parseDatabaseModel, type DatabaseModel } from '@adminium/engine/adapter';

import {
  detectServerFlavor,
  interpretGrants,
  interpretProbe,
  introspectMysql,
  introspectionStatements,
  checkConstraintsSql,
  columnsSql,
  foreignKeysSql,
  statisticsSql,
  tableConstraintsSql,
  tablesSql,
  type CatalogRow,
} from '../src/introspect.js';

const DB = 'appdb';

// ---------------------------------------------------------------------------
// Canned information_schema rows for a small but feature-dense schema
// ---------------------------------------------------------------------------

const TABLES: CatalogRow[] = [
  {
    table_name: 'customers',
    table_type: 'BASE TABLE',
    engine: 'InnoDB',
    table_rows: 300,
    size_bytes: 49152,
    table_comment: 'Registered customers',
  },
  {
    table_name: 'legacy_stats',
    table_type: 'BASE TABLE',
    engine: 'MyISAM',
    table_rows: 12,
    size_bytes: 2048,
    table_comment: '',
  },
  {
    table_name: 'open_orders',
    table_type: 'VIEW',
    engine: null,
    table_rows: null,
    size_bytes: 0,
    table_comment: '',
  },
  {
    table_name: 'orders',
    table_type: 'BASE TABLE',
    engine: 'InnoDB',
    table_rows: 1200,
    size_bytes: 114688,
    table_comment: 'Customer orders',
  },
];

const COLUMNS: CatalogRow[] = [
  // customers -----------------------------------------------------------------
  {
    table_name: 'customers',
    column_name: 'id',
    ordinal: 1,
    column_type: 'bigint unsigned',
    data_type: 'bigint',
    is_nullable: 'NO',
    default_value: null,
    extra: 'auto_increment',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 20,
    numeric_scale: 0,
  },
  {
    table_name: 'customers',
    column_name: 'email',
    ordinal: 2,
    column_type: 'varchar(190)',
    data_type: 'varchar',
    is_nullable: 'NO',
    default_value: null,
    extra: '',
    column_comment: 'Login email',
    char_max_length: 190,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'customers',
    column_name: 'uuid',
    ordinal: 3,
    column_type: 'char(36)',
    data_type: 'char',
    is_nullable: 'YES',
    default_value: 'uuid()',
    extra: 'DEFAULT_GENERATED',
    column_comment: '',
    char_max_length: 36,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'customers',
    column_name: 'tier',
    ordinal: 4,
    column_type: 'varchar(10)',
    data_type: 'varchar',
    is_nullable: 'NO',
    default_value: 'free',
    extra: '',
    column_comment: '',
    char_max_length: 10,
    numeric_precision: null,
    numeric_scale: null,
  },
  // legacy_stats ----------------------------------------------------------------
  {
    table_name: 'legacy_stats',
    column_name: 'id',
    ordinal: 1,
    column_type: 'int',
    data_type: 'int',
    is_nullable: 'NO',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 10,
    numeric_scale: 0,
  },
  // open_orders (view) ----------------------------------------------------------
  {
    table_name: 'open_orders',
    column_name: 'id',
    ordinal: 1,
    column_type: 'bigint unsigned',
    data_type: 'bigint',
    is_nullable: 'NO',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 20,
    numeric_scale: 0,
  },
  {
    table_name: 'open_orders',
    column_name: 'status',
    ordinal: 2,
    column_type: "enum('new','paid','shipped')",
    data_type: 'enum',
    is_nullable: 'NO',
    default_value: 'new',
    extra: '',
    column_comment: '',
    char_max_length: 7,
    numeric_precision: null,
    numeric_scale: null,
  },
  // orders ------------------------------------------------------------------
  {
    table_name: 'orders',
    column_name: 'id',
    ordinal: 1,
    column_type: 'bigint unsigned',
    data_type: 'bigint',
    is_nullable: 'NO',
    default_value: null,
    extra: 'auto_increment',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 20,
    numeric_scale: 0,
  },
  {
    table_name: 'orders',
    column_name: 'customer_id',
    ordinal: 2,
    column_type: 'bigint unsigned',
    data_type: 'bigint',
    is_nullable: 'YES',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 20,
    numeric_scale: 0,
  },
  {
    table_name: 'orders',
    column_name: 'status',
    ordinal: 3,
    column_type: "enum('new','paid','shipped')",
    data_type: 'enum',
    is_nullable: 'NO',
    default_value: 'new',
    extra: '',
    column_comment: 'Workflow state',
    char_max_length: 7,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'orders',
    column_name: 'total',
    ordinal: 4,
    column_type: 'decimal(10,2)',
    data_type: 'decimal',
    is_nullable: 'NO',
    default_value: '0.00',
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 10,
    numeric_scale: 2,
  },
  {
    table_name: 'orders',
    column_name: 'is_paid',
    ordinal: 5,
    column_type: 'tinyint(1)',
    data_type: 'tinyint',
    is_nullable: 'NO',
    default_value: '0',
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 3,
    numeric_scale: 0,
  },
  {
    table_name: 'orders',
    column_name: 'created_at',
    ordinal: 6,
    column_type: 'timestamp',
    data_type: 'timestamp',
    is_nullable: 'NO',
    default_value: 'CURRENT_TIMESTAMP',
    extra: 'DEFAULT_GENERATED',
    column_comment: '',
    char_max_length: null,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'orders',
    column_name: 'updated_at',
    ordinal: 7,
    column_type: 'datetime',
    data_type: 'datetime',
    is_nullable: 'YES',
    default_value: 'CURRENT_TIMESTAMP',
    extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP',
    column_comment: '',
    char_max_length: null,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'orders',
    column_name: 'meta',
    ordinal: 8,
    column_type: 'json',
    data_type: 'json',
    is_nullable: 'YES',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'orders',
    column_name: 'tags',
    ordinal: 9,
    column_type: "set('gift','rush','fragile')",
    data_type: 'set',
    is_nullable: 'YES',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: 17,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'orders',
    column_name: 'doc_year',
    ordinal: 10,
    column_type: 'year',
    data_type: 'year',
    is_nullable: 'YES',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: null,
    numeric_scale: null,
  },
  {
    table_name: 'orders',
    column_name: 'total_with_tax',
    ordinal: 11,
    column_type: 'decimal(12,2)',
    data_type: 'decimal',
    is_nullable: 'YES',
    default_value: null,
    extra: 'STORED GENERATED',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 12,
    numeric_scale: 2,
  },
];

const STATISTICS: CatalogRow[] = [
  {
    table_name: 'customers',
    index_name: 'PRIMARY',
    non_unique: 0,
    seq_in_index: 1,
    column_name: 'id',
    index_type: 'BTREE',
  },
  {
    table_name: 'customers',
    index_name: 'customers_email_unique',
    non_unique: 0,
    seq_in_index: 1,
    column_name: 'email',
    index_type: 'BTREE',
  },
  {
    table_name: 'orders',
    index_name: 'PRIMARY',
    non_unique: 0,
    seq_in_index: 1,
    column_name: 'id',
    index_type: 'BTREE',
  },
  {
    table_name: 'orders',
    index_name: 'orders_customer_idx',
    non_unique: 1,
    seq_in_index: 1,
    column_name: 'customer_id',
    index_type: 'BTREE',
  },
  {
    table_name: 'legacy_stats',
    index_name: 'PRIMARY',
    non_unique: 0,
    seq_in_index: 1,
    column_name: 'id',
    index_type: 'BTREE',
  },
];

const FOREIGN_KEYS: CatalogRow[] = [
  {
    table_name: 'orders',
    constraint_name: 'orders_customer_fk',
    column_name: 'customer_id',
    ordinal: 1,
    ref_schema: DB,
    ref_table: 'customers',
    ref_column: 'id',
    on_update: 'CASCADE',
    on_delete: 'SET NULL',
  },
];

const TABLE_CONSTRAINTS: CatalogRow[] = [
  { table_name: 'customers', constraint_name: 'PRIMARY', constraint_type: 'PRIMARY KEY' },
  {
    table_name: 'customers',
    constraint_name: 'customers_email_unique',
    constraint_type: 'UNIQUE',
  },
  {
    table_name: 'customers',
    constraint_name: 'customers_tier_check',
    constraint_type: 'CHECK',
  },
  { table_name: 'orders', constraint_name: 'PRIMARY', constraint_type: 'PRIMARY KEY' },
  {
    table_name: 'orders',
    constraint_name: 'orders_customer_fk',
    constraint_type: 'FOREIGN KEY',
  },
];

const CHECK_CONSTRAINTS: CatalogRow[] = [
  {
    constraint_name: 'customers_tier_check',
    check_clause: "(`tier` in (_utf8mb4\\'free\\',_utf8mb4\\'pro\\',_utf8mb4\\'team\\'))",
  },
];

function cannedExecutor(overrides: Partial<Record<string, CatalogRow[]>> = {}) {
  const bySql = new Map<string, CatalogRow[]>([
    [tablesSql(DB), overrides['tables'] ?? TABLES],
    [columnsSql(DB), overrides['columns'] ?? COLUMNS],
    [statisticsSql(DB), overrides['statistics'] ?? STATISTICS],
    [foreignKeysSql(DB), overrides['foreignKeys'] ?? FOREIGN_KEYS],
    [tableConstraintsSql(DB), overrides['tableConstraints'] ?? TABLE_CONSTRAINTS],
    [checkConstraintsSql(DB), overrides['checkConstraints'] ?? CHECK_CONSTRAINTS],
  ]);
  let statements = 0;
  const executor = async (sql: string): Promise<CatalogRow[]> => {
    statements += 1;
    const rows = bySql.get(sql);
    if (rows === undefined) throw new Error(`unexpected statement:\n${sql}`);
    return rows;
  };
  return Object.assign(executor, { count: () => statements });
}

// ---------------------------------------------------------------------------
// The SQL-text contract
// ---------------------------------------------------------------------------

describe('introspection statement set (05 §4.2/§10)', () => {
  const statements = introspectionStatements(DB);

  it('is a fixed set of 6 statements (+1 probe = 7 per 05 §4.2, ≤ 10 budget)', () => {
    expect(statements).toHaveLength(6);
    expect(statements.length + 1).toBeLessThanOrEqual(10);
  });

  it('every FROM/JOIN target is an information_schema view (schema only)', () => {
    for (const sql of statements) {
      const targets = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)].map((m) => m[1] ?? '');
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target).toMatch(/^information_schema\./);
      }
    }
  });

  it('every statement is scoped to the connected database', () => {
    for (const sql of statements) {
      expect(sql).toMatch(/(TABLE_SCHEMA|CONSTRAINT_SCHEMA) = 'appdb'/);
    }
  });

  it('escapes quotes in the schema literal', () => {
    expect(tablesSql("we'ird")).toContain("TABLE_SCHEMA = 'we''ird'");
  });
});

// ---------------------------------------------------------------------------
// Assembly through the canned executor
// ---------------------------------------------------------------------------

// Assembled once at module scope (top-level await) so the statement counter
// reflects exactly one introspection run.
const assemblyExec = cannedExecutor();
const assembledModel: DatabaseModel = await introspectMysql(assemblyExec, {
  connectionId: DB,
  databaseName: DB,
});

describe('introspectMysql assembly (canned executor)', () => {
  const exec = assemblyExec;
  const model = assembledModel;
  const table = (name: string) => model.tables.find((t) => t.id === `${DB}.${name}`);
  const column = (tableName: string, name: string) =>
    table(tableName)?.columns.find((c) => c.name === name);

  it('issues exactly the fixed statement set', () => {
    expect(exec.count()).toBe(6);
  });

  it('is a valid DatabaseModel per the engine Zod contract', () => {
    expect(() => parseDatabaseModel(JSON.stringify(model))).not.toThrow();
    expect(model).toMatchObject({
      dialect: 'mysql',
      name: DB,
      defaultSchema: DB,
      schemas: [DB],
    });
    expect(model.capabilities).toMatchObject({
      hasSchemas: false,
      hasEnums: true,
      supportsReturning: false,
      maxIdentifierLength: 64,
    });
  });

  it('maps tables, views, comments, estimates, and sizes', () => {
    expect(model.tables.map((t) => t.name)).toEqual([
      'customers',
      'legacy_stats',
      'open_orders',
      'orders',
    ]);
    expect(table('orders')).toMatchObject({
      kind: 'table',
      comment: 'Customer orders',
      rowCountEstimate: 1200,
      rowCountExact: false,
      sizeBytes: 114688,
      activity: null,
      rls: null,
    });
    expect(table('open_orders')).toMatchObject({
      kind: 'view',
      primaryKey: [],
      rowCountEstimate: null,
      sizeBytes: null,
    });
  });

  it('parses enum(...) columns into column-type EnumDefs', () => {
    const def = model.enums.find((e) => e.id === `${DB}.orders.status`);
    expect(def).toMatchObject({
      name: 'status',
      values: ['new', 'paid', 'shipped'],
      source: 'column-type',
    });
    expect(column('orders', 'status')).toMatchObject({
      logicalType: 'enum',
      enumRef: `${DB}.orders.status`,
      comment: 'Workflow state',
      default: { kind: 'literal', text: 'new' },
    });
  });

  it('synthesizes a check EnumDef from CHECK (col IN (...))', () => {
    const def = model.enums.find((e) => e.id === `${DB}.customers.tier`);
    expect(def).toMatchObject({ values: ['free', 'pro', 'team'], source: 'check' });
    expect(column('customers', 'tier')?.enumRef).toBe(`${DB}.customers.tier`);
    expect(table('customers')?.checks).toEqual([
      { name: 'customers_tier_check', expression: "`tier` in ('free','pro','team')" },
    ]);
  });

  it('degrades set(...) to text and year to integer, with warnings', () => {
    expect(column('orders', 'tags')?.logicalType).toBe('text');
    expect(column('orders', 'doc_year')?.logicalType).toBe('integer');
    expect(model.warnings.some((w) => w.code === 'set-as-text')).toBe(true);
    expect(model.warnings.some((w) => w.code === 'year-as-integer')).toBe(true);
  });

  it('flags unsigned bigint overflow and the MyISAM engine', () => {
    expect(model.warnings.some((w) => w.code === 'unsigned-overflow')).toBe(true);
    expect(
      model.warnings.find((w) => w.code === 'myisam-no-fks')?.tableId,
    ).toBe(`${DB}.legacy_stats`);
  });

  it('maps tinyint(1) to boolean and applies the char(36) uuid heuristic', () => {
    expect(column('orders', 'is_paid')).toMatchObject({
      logicalType: 'boolean',
      default: { kind: 'literal', text: '0' },
    });
    expect(column('customers', 'uuid')).toMatchObject({
      logicalType: 'uuid',
      default: { kind: 'uuid' },
    });
  });

  it('classifies auto_increment, CURRENT_TIMESTAMP, and generated columns', () => {
    expect(column('orders', 'id')).toMatchObject({
      logicalType: 'bigint',
      isPrimaryKey: true,
      isUnique: true,
      default: { kind: 'autoincrement' },
    });
    expect(column('orders', 'created_at')).toMatchObject({
      logicalType: 'timestamptz',
      default: { kind: 'now' },
    });
    expect(column('orders', 'updated_at')).toMatchObject({
      logicalType: 'timestamp',
      default: { kind: 'now' },
    });
    expect(column('orders', 'total_with_tax')).toMatchObject({
      isGenerated: true,
      default: null,
    });
  });

  it('assembles PK, uniques, and indexes from STATISTICS', () => {
    expect(table('orders')?.primaryKey).toEqual(['id']);
    expect(table('customers')?.uniques).toEqual([
      { name: 'customers_email_unique', columns: ['email'] },
    ]);
    expect(column('customers', 'email')?.isUnique).toBe(true);
    expect(table('orders')?.indexes.map((i) => i.name)).toEqual([
      'PRIMARY',
      'orders_customer_idx',
    ]);
    expect(table('orders')?.indexes.find((i) => i.name === 'PRIMARY')).toMatchObject({
      unique: true,
      primary: true,
      method: 'btree',
    });
  });

  it('maps FKs with onDelete/onUpdate rules and per-column mirrors', () => {
    expect(model.relations).toHaveLength(1);
    expect(model.relations[0]).toMatchObject({
      id: `fk:${DB}.orders(customer_id)->${DB}.customers(id)`,
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      onDelete: 'set-null',
      onUpdate: 'cascade',
      selfReferential: false,
      confidence: 1,
    });
    expect(column('orders', 'customer_id')?.references).toEqual({
      tableId: `${DB}.customers`,
      column: 'id',
    });
  });
});

describe('introspectMysql degradations', () => {
  it('skips relations whose target is filtered out, with a warning', async () => {
    const model = await introspectMysql(
      cannedExecutor(),
      { connectionId: DB, databaseName: DB },
      { tableFilter: ({ name }) => name !== 'customers' },
    );
    expect(model.tables.some((t) => t.name === 'customers')).toBe(false);
    expect(model.relations).toHaveLength(0);
    expect(model.warnings.some((w) => w.code === 'fk-target-excluded')).toBe(true);
  });

  it('degrades gracefully when CHECK_CONSTRAINTS is unavailable (< 8.0.16)', async () => {
    const exec = cannedExecutor();
    const failing = async (sql: string) => {
      if (sql === checkConstraintsSql(DB)) {
        throw Object.assign(new Error("Unknown table 'CHECK_CONSTRAINTS'"), {
          code: 'ER_NO_SUCH_TABLE',
        });
      }
      return exec(sql);
    };
    const model = await introspectMysql(failing, { connectionId: DB, databaseName: DB });
    expect(model.warnings.some((w) => w.code === 'checks-unavailable')).toBe(true);
    expect(model.tables.find((t) => t.name === 'customers')?.checks).toEqual([]);
    expect(model.enums.some((e) => e.source === 'check')).toBe(false);
  });

  it('honors collectRowEstimates=false', async () => {
    const model = await introspectMysql(
      cannedExecutor(),
      { connectionId: DB, databaseName: DB },
      { collectRowEstimates: false },
    );
    expect(model.tables.every((t) => t.rowCountEstimate === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Probe / grants interpretation (pure, executor-free)
// ---------------------------------------------------------------------------

describe('detectServerFlavor', () => {
  it.each([
    ['8.0.36', 'mysql', 8, 0, true],
    ['9.1.0', 'mysql', 9, 1, true],
    ['5.7.44-log', 'mysql', 5, 7, false],
    ['10.5.0-MariaDB', 'mariadb', 10, 5, true],
    ['10.4.32-MariaDB-1:10.4.32+maria~ubu2004', 'mariadb', 10, 4, false],
    ['11.4.2-MariaDB', 'mariadb', 11, 4, true],
  ] as const)('reads %s', (version, flavor, major, minor, supported) => {
    expect(detectServerFlavor(version)).toEqual({ flavor, major, minor, supported });
  });

  it('strips MariaDB’s 5.5.5 replication-compat prefix', () => {
    // Without the strip this reads as "5.5", i.e. unsupported — MariaDB sends
    // the prefix so that old MySQL replicas keep talking to it.
    expect(detectServerFlavor('5.5.5-10.6.14-MariaDB-log')).toMatchObject({
      flavor: 'mariadb',
      major: 10,
      minor: 6,
      supported: true,
    });
  });

  it('does not strip the prefix from a genuine MySQL 5.5.5', () => {
    expect(detectServerFlavor('5.5.5')).toMatchObject({ flavor: 'mysql', major: 5, minor: 5 });
  });

  it('degrades an unparseable version to 0.0 / unsupported rather than guessing', () => {
    expect(detectServerFlavor('')).toEqual({
      flavor: 'mysql',
      major: 0,
      minor: 0,
      supported: false,
    });
    expect(detectServerFlavor('who knows').supported).toBe(false);
  });

  it('is case-insensitive about the MariaDB marker', () => {
    expect(detectServerFlavor('10.6.14-mariadb').flavor).toBe('mariadb');
  });
});

describe('interpretProbe', () => {
  it('reads a healthy probe row', () => {
    expect(
      interpretProbe({
        server_version: '8.0.36',
        role_name: 'app@%',
        database_name: 'appdb',
        read_only: 0,
      }),
    ).toMatchObject({
      serverVersion: '8.0.36',
      roleName: 'app@%',
      databaseName: 'appdb',
      readOnly: false,
    });
  });

  it.each([
    ['numeric 1', 1, true],
    ['string "1"', '1', true],
    ['string "ON"', 'ON', true],
    ['numeric 0', 0, false],
    ['string "OFF"', 'OFF', false],
  ] as const)('reads @@read_only as %s', (_label, raw, expected) => {
    // The wire form varies by driver config (typeCast on/off).
    expect(interpretProbe({ read_only: raw }).readOnly).toBe(expected);
  });

  it('reports a null database when the DSN names none', () => {
    expect(interpretProbe({ database_name: null }).databaseName).toBeNull();
    expect(interpretProbe({}).databaseName).toBeNull();
  });

  it('degrades an empty row to empty strings rather than "undefined"', () => {
    const probe = interpretProbe({});
    expect(probe.serverVersion).toBe('');
    expect(probe.roleName).toBe('');
    expect(probe.flavor.supported).toBe(false);
  });
});

describe('interpretGrants', () => {
  const grant = (line: string) => [{ 'Grants for x': line }];

  it('reads ALL PRIVILEGES on the database as full access', () => {
    expect(interpretGrants(grant('GRANT ALL PRIVILEGES ON `appdb`.* TO `app`@`%`'), 'appdb')).toEqual(
      { canSelect: true, canWrite: true, canDDL: true },
    );
  });

  it('reads a bare ALL as full access', () => {
    expect(interpretGrants(grant('GRANT ALL ON `appdb`.* TO `app`@`%`'), 'appdb')).toEqual({
      canSelect: true,
      canWrite: true,
      canDDL: true,
    });
  });

  it('reads a SELECT-only grant as read but not write', () => {
    expect(interpretGrants(grant('GRANT SELECT ON `appdb`.* TO `ro`@`%`'), 'appdb')).toEqual({
      canSelect: true,
      canWrite: false,
      canDDL: false,
    });
  });

  it.each([
    ['INSERT', { canSelect: false, canWrite: true, canDDL: false }],
    ['UPDATE', { canSelect: false, canWrite: true, canDDL: false }],
    ['DELETE', { canSelect: false, canWrite: true, canDDL: false }],
    ['CREATE', { canSelect: false, canWrite: false, canDDL: true }],
    ['ALTER', { canSelect: false, canWrite: false, canDDL: true }],
    ['DROP', { canSelect: false, canWrite: false, canDDL: true }],
  ] as const)('classifies a %s grant', (privilege, expected) => {
    expect(interpretGrants(grant(`GRANT ${privilege} ON \`appdb\`.* TO \`u\`@\`%\``), 'appdb')).toEqual(
      expected,
    );
  });

  it('accumulates privileges across several grant rows', () => {
    const rows = [
      { g: 'GRANT SELECT ON `appdb`.* TO `u`@`%`' },
      { g: 'GRANT INSERT, UPDATE ON `appdb`.* TO `u`@`%`' },
    ];
    expect(interpretGrants(rows, 'appdb')).toEqual({
      canSelect: true,
      canWrite: true,
      canDDL: false,
    });
  });

  it('honors a global *.* grant', () => {
    expect(interpretGrants(grant('GRANT SELECT ON *.* TO `u`@`%`'), 'appdb').canSelect).toBe(true);
  });

  it('ignores grants scoped to a DIFFERENT database', () => {
    // The whole reason the scope is parsed: a user with ALL on `other` must not
    // be reported as able to write `appdb`.
    expect(interpretGrants(grant('GRANT ALL PRIVILEGES ON `other`.* TO `u`@`%`'), 'appdb')).toEqual({
      canSelect: false,
      canWrite: false,
      canDDL: false,
    });
  });

  it('matches the database name case-insensitively', () => {
    expect(interpretGrants(grant('GRANT SELECT ON `APPDB`.* TO `u`@`%`'), 'appdb').canSelect).toBe(
      true,
    );
  });

  it('accepts a table-level grant on the database', () => {
    expect(
      interpretGrants(grant('GRANT SELECT ON `appdb`.`orders` TO `u`@`%`'), 'appdb').canSelect,
    ).toBe(true);
  });

  it('strips both backtick and double-quote identifier quoting', () => {
    expect(interpretGrants(grant('GRANT SELECT ON "appdb".* TO "u"@"%"'), 'appdb').canSelect).toBe(
      true,
    );
    expect(interpretGrants(grant('GRANT SELECT ON appdb.* TO u@%'), 'appdb').canSelect).toBe(true);
  });

  it('skips rows that are not GRANT … ON … TO lines', () => {
    const rows = [
      { g: 'GRANT PROXY ON ``@`` TO `u`@`%`' }, // no ON <scope> TO shape we parse
      { g: 'REVOKE SELECT ON `appdb`.* FROM `u`@`%`' },
      { g: '' },
      {},
      { g: 'GRANT SELECT ON `appdb`.* TO `u`@`%`' },
    ];
    expect(interpretGrants(rows, 'appdb')).toEqual({
      canSelect: true,
      canWrite: false,
      canDDL: false,
    });
  });

  it('returns no privileges for no rows', () => {
    expect(interpretGrants([], 'appdb')).toEqual({
      canSelect: false,
      canWrite: false,
      canDDL: false,
    });
  });

  it('does not read a privilege out of the middle of a word', () => {
    // `\b` matters: a role or column named "SELECTED" must not grant SELECT.
    expect(interpretGrants(grant('GRANT SELECTED ON `appdb`.* TO `u`@`%`'), 'appdb').canSelect).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Assembly edge cases — rows a healthy fixture never produces
// ---------------------------------------------------------------------------

interface Catalog {
  tables?: CatalogRow[];
  columns?: CatalogRow[];
  statistics?: CatalogRow[];
  foreignKeys?: CatalogRow[];
  tableConstraints?: CatalogRow[];
  checkConstraints?: CatalogRow[] | Error;
}

/** Route by a fragment unique to each of the six statements. */
function routed(rows: Catalog): ((sql: string) => Promise<CatalogRow[]>) & { calls: string[] } {
  const calls: string[] = [];
  const exec = async (sql: string): Promise<CatalogRow[]> => {
    calls.push(sql);
    if (sql.includes('information_schema.TABLES')) return rows.tables ?? [];
    if (sql.includes('information_schema.COLUMNS')) return rows.columns ?? [];
    if (sql.includes('information_schema.STATISTICS')) return rows.statistics ?? [];
    if (sql.includes('KEY_COLUMN_USAGE')) return rows.foreignKeys ?? [];
    if (sql.includes('information_schema.TABLE_CONSTRAINTS')) return rows.tableConstraints ?? [];
    if (sql.includes('information_schema.CHECK_CONSTRAINTS')) {
      if (rows.checkConstraints instanceof Error) throw rows.checkConstraints;
      return rows.checkConstraints ?? [];
    }
    throw new Error(`unrouted statement: ${sql.slice(0, 60)}`);
  };
  return Object.assign(exec, { calls });
}

const CTX = { connectionId: DB, databaseName: DB };

/** An information_schema.COLUMNS row with healthy defaults. */
function col(over: Partial<CatalogRow> & { table_name: string }): CatalogRow {
  return {
    column_name: 'c',
    ordinal: 1,
    column_type: 'int',
    data_type: 'int',
    is_nullable: 'YES',
    default_value: null,
    extra: '',
    column_comment: '',
    char_max_length: null,
    numeric_precision: 10,
    numeric_scale: 0,
    ...over,
  };
}

describe('introspectMysql — time budget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts with TIMEOUT once the total budget is spent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-05T00:00:00.000Z'));
    const inner = routed({ tables: [{ table_name: 't', table_type: 'BASE TABLE' }] });
    const exec = async (sql: string): Promise<CatalogRow[]> => {
      const rows = await inner(sql);
      vi.advanceTimersByTime(20_000);
      return rows;
    };

    const failure = await introspectMysql(exec, CTX, { timeoutMs: 30_000 }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AdapterError);
    expect((failure as AdapterError).code).toBe('TIMEOUT');
    expect((failure as AdapterError).detail).toBe('timeoutMs=30000');
    // Two statements ran; the third was refused before being sent.
    expect(inner.calls).toHaveLength(2);
  });

  it('reports a duration and a pinned introspectedAt on a clean run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-05T00:00:00.000Z'));
    const inner = routed({});
    const exec = async (sql: string): Promise<CatalogRow[]> => {
      const rows = await inner(sql);
      vi.advanceTimersByTime(1_000);
      return rows;
    };

    const model = await introspectMysql(exec, CTX, { timeoutMs: 30_000 });
    expect(model.stats.durationMs).toBe(6_000); // six catalog statements
    expect(model.introspectedAt).toBe('2024-03-05T00:00:06.000Z');
  });

  it('does NOT swallow a timeout raised by the CHECK_CONSTRAINTS probe', async () => {
    // That probe is guarded because the view is absent before 8.0.16 — but a
    // spent budget is not a missing view, and degrading it would let
    // introspection run past its deadline.
    const exec = routed({ checkConstraints: new AdapterError('TIMEOUT', 'budget spent') });
    await expect(introspectMysql(exec, CTX)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('introspectMysql — table rows', () => {
  it('applies tableFilter and drops the filtered table’s columns too', async () => {
    const exec = routed({
      tables: [
        { table_name: 'keep', table_type: 'BASE TABLE' },
        { table_name: 'drop', table_type: 'BASE TABLE' },
      ],
      columns: [col({ table_name: 'drop', column_name: 'x' })],
    });
    const model = await introspectMysql(exec, CTX, { tableFilter: ({ name }) => name === 'keep' });

    expect(model.tables.map((t) => t.name)).toEqual(['keep']);
    expect(model.stats.columnCount).toBe(0);
  });

  it('passes the connected database to tableFilter as the schema', async () => {
    const seen: { schema: string; name: string }[] = [];
    const exec = routed({ tables: [{ table_name: 't', table_type: 'BASE TABLE' }] });
    await introspectMysql(exec, CTX, {
      tableFilter: (t) => {
        seen.push(t);
        return true;
      },
    });
    expect(seen).toEqual([{ schema: DB, name: 't' }]);
  });

  it('never puts a size or row estimate on a view', async () => {
    const exec = routed({
      tables: [
        { table_name: 'v', table_type: 'VIEW', table_rows: 5, size_bytes: 100, engine: null },
        { table_name: 't', table_type: 'BASE TABLE', table_rows: 5, size_bytes: 100 },
      ],
    });
    const model = await introspectMysql(exec, CTX);

    const view = model.tables.find((t) => t.name === 'v')!;
    expect(view.kind).toBe('view');
    expect(view.rowCountEstimate).toBeNull();
    expect(view.sizeBytes).toBeNull();
    const table = model.tables.find((t) => t.name === 't')!;
    expect(table.rowCountEstimate).toBe(5);
    expect(table.sizeBytes).toBe(100);
  });

  it('does not warn about MyISAM on a view', async () => {
    const exec = routed({
      tables: [{ table_name: 'v', table_type: 'VIEW', engine: 'MyISAM' }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.warnings.filter((w) => w.code === 'myisam-no-fks')).toHaveLength(0);
  });

  it('matches the MyISAM engine case-insensitively', async () => {
    const exec = routed({ tables: [{ table_name: 't', table_type: 'BASE TABLE', engine: 'myisam' }] });
    const model = await introspectMysql(exec, CTX);
    expect(model.warnings.some((w) => w.code === 'myisam-no-fks')).toBe(true);
  });

  it('leaves the estimate null when TABLE_ROWS is absent', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE', table_rows: null }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.rowCountEstimate).toBeNull();
    expect(model.tables[0]!.rowCountExact).toBe(false);
  });

  it('has no RLS or activity to report — those are Postgres-only', async () => {
    const exec = routed({ tables: [{ table_name: 't', table_type: 'BASE TABLE' }] });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.rls).toBeNull();
    expect(model.tables[0]!.activity).toBeNull();
  });
});

describe('introspectMysql — column rows', () => {
  it('drops a column whose table is not in the introspected set', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [col({ table_name: 't', column_name: 'kept' }), col({ table_name: 'ghost' })],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.columns.map((c) => c.name)).toEqual(['kept']);
  });

  it('falls back to DATA_TYPE when COLUMN_TYPE is absent', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [col({ table_name: 't', column_name: 'a', column_type: null, data_type: 'int' })],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.columns[0]!.dbType).toBe('int');
    expect(model.tables[0]!.columns[0]!.logicalType).toBe('integer');
  });

  it('degrades to an unknown type when neither type column is present', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [col({ table_name: 't', column_name: 'a', column_type: null, data_type: null })],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.columns[0]!.dbType).toBe('unknown');
    expect(model.tables[0]!.columns[0]!.logicalType).toBe('unknown');
  });

  it('caps a runaway enum at 256 values and says so', async () => {
    const values = Array.from({ length: 300 }, (_, i) => `'v${i}'`).join(',');
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [col({ table_name: 't', column_name: 'big', column_type: `enum(${values})` })],
    });
    const model = await introspectMysql(exec, CTX);

    const enumDef = model.enums.find((e) => e.id === `${DB}.t.big`)!;
    expect(enumDef.values).toHaveLength(256);
    const warning = model.warnings.find((w) => w.code === 'enum-capped');
    expect(warning!.message).toContain('300');
    expect(warning!.tableId).toBe(`${DB}.t`);
  });

  it('degrades a valueless enum(...) to text rather than an empty EnumDef', async () => {
    // The IR requires an EnumDef to carry at least one value, so an
    // unparseable enum must not produce one.
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [col({ table_name: 't', column_name: 'weird', column_type: 'enum()' })],
    });
    const model = await introspectMysql(exec, CTX);

    expect(model.enums).toHaveLength(0);
    expect(model.tables[0]!.columns[0]!.logicalType).toBe('text');
    expect(model.tables[0]!.columns[0]!.enumRef).toBeNull();
    expect(() => parseDatabaseModel(model)).not.toThrow();
  });

  it('applies the uuid heuristic only to 36-char columns named like a uuid', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [
        col({ table_name: 't', column_name: 'uuid', column_type: 'char(36)', ordinal: 1 }),
        col({ table_name: 't', column_name: 'row_guid', column_type: 'char(36)', ordinal: 2 }),
        // Right length, wrong name.
        col({ table_name: 't', column_name: 'label', column_type: 'char(36)', ordinal: 3 }),
        // Right name, wrong length.
        col({ table_name: 't', column_name: 'uuid_short', column_type: 'char(10)', ordinal: 4 }),
      ],
    });
    const model = await introspectMysql(exec, CTX);
    const byName = Object.fromEntries(model.tables[0]!.columns.map((c) => [c.name, c.logicalType]));

    expect(byName['uuid']).toBe('uuid');
    expect(byName['row_guid']).toBe('uuid');
    expect(byName['label']).toBe('varchar');
    expect(byName['uuid_short']).toBe('varchar');
  });

  it('treats DEFAULT_GENERATED as a default, not a generated column', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [
        col({
          table_name: 't',
          column_name: 'created_at',
          column_type: 'timestamp',
          extra: 'DEFAULT_GENERATED',
          default_value: 'CURRENT_TIMESTAMP',
        }),
        col({
          table_name: 't',
          column_name: 'total',
          column_type: 'int',
          extra: 'STORED GENERATED',
          default_value: '(`a` + `b`)',
        }),
      ],
    });
    const model = await introspectMysql(exec, CTX);

    const created = model.tables[0]!.columns.find((c) => c.name === 'created_at')!;
    expect(created.isGenerated).toBe(false);
    expect(created.default).not.toBeNull();
    const total = model.tables[0]!.columns.find((c) => c.name === 'total')!;
    expect(total.isGenerated).toBe(true);
    expect(total.default).toBeNull();
  });

  it('degrades a row with no column name or ordinal', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [col({ table_name: 't', column_name: null, ordinal: null, extra: null })],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.columns[0]!.name).toBe('');
    expect(model.tables[0]!.columns[0]!.ordinal).toBe(0);
  });
});

describe('introspectMysql — indexes from STATISTICS', () => {
  const oneTable = [{ table_name: 't', table_type: 'BASE TABLE' }];
  const twoColumns = [
    col({ table_name: 't', column_name: 'a', ordinal: 1 }),
    col({ table_name: 't', column_name: 'b', ordinal: 2 }),
  ];

  it('drops a statistics row for an unknown table', async () => {
    const exec = routed({
      tables: oneTable,
      columns: twoColumns,
      statistics: [{ table_name: 'ghost', index_name: 'i', non_unique: 0, column_name: 'a' }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.indexes).toEqual([]);
  });

  it('orders multi-column index parts by SEQ_IN_INDEX, not row order', async () => {
    const exec = routed({
      tables: oneTable,
      columns: twoColumns,
      statistics: [
        { table_name: 't', index_name: 'PRIMARY', non_unique: 0, seq_in_index: 2, column_name: 'b', index_type: 'BTREE' },
        { table_name: 't', index_name: 'PRIMARY', non_unique: 0, seq_in_index: 1, column_name: 'a', index_type: 'BTREE' },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.primaryKey).toEqual(['a', 'b']);
    expect(model.tables[0]!.indexes[0]!.method).toBe('btree');
  });

  it('does not mark a multi-column unique index as a unique COLUMN', async () => {
    const exec = routed({
      tables: oneTable,
      columns: twoColumns,
      statistics: [
        { table_name: 't', index_name: 'ab', non_unique: 0, seq_in_index: 1, column_name: 'a' },
        { table_name: 't', index_name: 'ab', non_unique: 0, seq_in_index: 2, column_name: 'b' },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.columns.every((c) => !c.isUnique)).toBe(true);
    expect(model.tables[0]!.uniques).toEqual([{ name: 'ab', columns: ['a', 'b'] }]);
  });

  it('records a non-unique index without adding a unique constraint', async () => {
    const exec = routed({
      tables: oneTable,
      columns: twoColumns,
      statistics: [
        { table_name: 't', index_name: 'idx_a', non_unique: 1, seq_in_index: 1, column_name: 'a' },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.indexes[0]!.unique).toBe(false);
    expect(model.tables[0]!.uniques).toEqual([]);
    expect(model.tables[0]!.columns.find((c) => c.name === 'a')!.isUnique).toBe(false);
  });

  it('skips an index part with no column name but keeps the index', async () => {
    const exec = routed({
      tables: oneTable,
      columns: twoColumns,
      statistics: [
        { table_name: 't', index_name: 'i', non_unique: 1, seq_in_index: 1, column_name: null, index_type: null },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.indexes[0]!.columns).toEqual([]);
    expect(model.tables[0]!.indexes[0]!.method).toBeNull();
  });

  it('degrades a statistics row with no index name', async () => {
    const exec = routed({
      tables: oneTable,
      columns: twoColumns,
      statistics: [{ table_name: 't', index_name: null, non_unique: null, column_name: 'a' }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.indexes[0]!.name).toBe('');
    // NON_UNIQUE absent must not be read as "unique".
    expect(model.tables[0]!.indexes[0]!.unique).toBe(false);
  });
});

describe('introspectMysql — foreign keys', () => {
  const twoTables = [
    { table_name: 'customers', table_type: 'BASE TABLE' },
    { table_name: 'orders', table_type: 'BASE TABLE' },
  ];
  const fkColumns = [
    col({ table_name: 'customers', column_name: 'id', ordinal: 1 }),
    col({ table_name: 'orders', column_name: 'id', ordinal: 1 }),
    col({ table_name: 'orders', column_name: 'customer_id', ordinal: 2 }),
  ];

  it('drops a foreign-key row for an unknown table', async () => {
    const exec = routed({
      tables: twoTables,
      columns: fkColumns,
      foreignKeys: [
        { table_name: 'ghost', constraint_name: 'fk', column_name: 'x', ref_table: 'customers' },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.relations).toEqual([]);
  });

  it('warns on a CROSS-DATABASE foreign key rather than emitting it', async () => {
    // Cross-database FKs are out of scope for v1 (05 §4.2): the target table
    // is not in the model, so a relation pointing at it would dangle.
    const exec = routed({
      tables: twoTables,
      columns: fkColumns,
      foreignKeys: [
        {
          table_name: 'orders',
          constraint_name: 'orders_other_fk',
          column_name: 'customer_id',
          ordinal: 1,
          ref_schema: 'otherdb',
          ref_table: 'customers',
          ref_column: 'id',
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);

    expect(model.relations).toEqual([]);
    const warning = model.warnings.find((w) => w.code === 'fk-target-excluded');
    expect(warning!.message).toContain('otherdb.customers');
    expect(warning!.tableId).toBe(`${DB}.orders`);
    expect(model.tables.find((t) => t.name === 'orders')!.columns.find((c) => c.name === 'customer_id')!.references).toBeNull();
  });

  it('defaults a missing REFERENCED_TABLE_SCHEMA to the connected database', async () => {
    const exec = routed({
      tables: twoTables,
      columns: fkColumns,
      foreignKeys: [
        {
          table_name: 'orders',
          constraint_name: 'fk',
          column_name: 'customer_id',
          ordinal: 1,
          ref_schema: null,
          ref_table: 'customers',
          ref_column: 'id',
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.relations).toHaveLength(1);
    expect(model.relations[0]!.to.tableId).toBe(`${DB}.customers`);
  });

  it('maps an unrecognized referential action to null rather than guessing', async () => {
    const exec = routed({
      tables: twoTables,
      columns: fkColumns,
      foreignKeys: [
        {
          table_name: 'orders',
          constraint_name: 'fk',
          column_name: 'customer_id',
          ordinal: 1,
          ref_table: 'customers',
          ref_column: 'id',
          on_update: 'WHO KNOWS',
          on_delete: null,
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.relations[0]!.onUpdate).toBeNull();
    expect(model.relations[0]!.onDelete).toBeNull();
  });

  it('orders composite key parts by ORDINAL_POSITION', async () => {
    const exec = routed({
      tables: twoTables,
      columns: [
        ...fkColumns,
        col({ table_name: 'orders', column_name: 'tenant_id', ordinal: 3 }),
        col({ table_name: 'customers', column_name: 'tenant_id', ordinal: 2 }),
      ],
      foreignKeys: [
        {
          table_name: 'orders',
          constraint_name: 'fk',
          column_name: 'tenant_id',
          ordinal: 2,
          ref_table: 'customers',
          ref_column: 'tenant_id',
        },
        {
          table_name: 'orders',
          constraint_name: 'fk',
          column_name: 'customer_id',
          ordinal: 1,
          ref_table: 'customers',
          ref_column: 'id',
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);

    expect(model.relations[0]!.from.columns).toEqual(['customer_id', 'tenant_id']);
    expect(model.relations[0]!.to.columns).toEqual(['id', 'tenant_id']);
  });

  it('flags a self-referential foreign key', async () => {
    const exec = routed({
      tables: [{ table_name: 'employees', table_type: 'BASE TABLE' }],
      columns: [
        col({ table_name: 'employees', column_name: 'id', ordinal: 1 }),
        col({ table_name: 'employees', column_name: 'manager_id', ordinal: 2 }),
      ],
      foreignKeys: [
        {
          table_name: 'employees',
          constraint_name: 'fk',
          column_name: 'manager_id',
          ordinal: 1,
          ref_table: 'employees',
          ref_column: 'id',
          on_delete: 'SET NULL',
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.relations[0]!.selfReferential).toBe(true);
    expect(model.relations[0]!.onDelete).toBe('set-null');
  });

  it('refines to one-to-one when a unique key covers exactly the FK columns', async () => {
    const exec = routed({
      tables: twoTables,
      columns: fkColumns,
      statistics: [
        { table_name: 'orders', index_name: 'uq_customer', non_unique: 0, seq_in_index: 1, column_name: 'customer_id' },
      ],
      foreignKeys: [
        {
          table_name: 'orders',
          constraint_name: 'fk',
          column_name: 'customer_id',
          ordinal: 1,
          ref_table: 'customers',
          ref_column: 'id',
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.relations[0]!.cardinality).toBe('one-to-one');
  });

  it('stays one-to-many when no unique key covers the FK', async () => {
    const exec = routed({
      tables: twoTables,
      columns: fkColumns,
      foreignKeys: [
        {
          table_name: 'orders',
          constraint_name: 'fk',
          column_name: 'customer_id',
          ordinal: 1,
          ref_table: 'customers',
          ref_column: 'id',
        },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    // An empty primary key must not read as "covers everything".
    expect(model.tables.find((t) => t.name === 'orders')!.primaryKey).toEqual([]);
    expect(model.relations[0]!.cardinality).toBe('one-to-many');
  });
});

describe('introspectMysql — check constraints', () => {
  const oneTable = [{ table_name: 't', table_type: 'BASE TABLE' }];
  const tierColumn = [col({ table_name: 't', column_name: 'tier', column_type: 'varchar(10)' })];

  it('ignores TABLE_CONSTRAINTS rows that are not CHECK', async () => {
    const exec = routed({
      tables: oneTable,
      columns: tierColumn,
      tableConstraints: [{ table_name: 't', constraint_name: 'PRIMARY', constraint_type: 'PRIMARY KEY' }],
      checkConstraints: [{ constraint_name: 'PRIMARY', check_clause: "(`tier` in ('a'))" }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.checks).toEqual([]);
    expect(model.enums).toEqual([]);
  });

  it('skips a CHECK whose clause was not returned', async () => {
    const exec = routed({
      tables: oneTable,
      columns: tierColumn,
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.checks).toEqual([]);
  });

  it('skips a CHECK on an unknown table or with no name', async () => {
    const exec = routed({
      tables: oneTable,
      columns: tierColumn,
      tableConstraints: [
        { table_name: 'ghost', constraint_name: 'ck1', constraint_type: 'CHECK' },
        { table_name: 't', constraint_name: null, constraint_type: 'CHECK' },
      ],
      checkConstraints: [{ constraint_name: 'ck1', check_clause: "(`tier` in ('a'))" }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.checks).toEqual([]);
  });

  it('ignores a CHECK_CONSTRAINTS row missing a name or a clause', async () => {
    const exec = routed({
      tables: oneTable,
      columns: tierColumn,
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [
        { constraint_name: null, check_clause: "(`tier` in ('a'))" },
        { constraint_name: 'ck', check_clause: null },
      ],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.checks).toEqual([]);
  });

  it('does not overwrite a column-type enum with a synthesized CHECK enum', async () => {
    const exec = routed({
      tables: oneTable,
      columns: [col({ table_name: 't', column_name: 'tier', column_type: "enum('free','pro')" })],
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [{ constraint_name: 'ck', check_clause: "(`tier` in ('x','y'))" }],
    });
    const model = await introspectMysql(exec, CTX);

    // The native enum wins; the check is still recorded.
    expect(model.tables[0]!.columns[0]!.enumRef).toBe(`${DB}.t.tier`);
    expect(model.enums.find((e) => e.id === `${DB}.t.tier`)!.source).toBe('column-type');
    expect(model.enums.find((e) => e.id === `${DB}.t.tier`)!.values).toEqual(['free', 'pro']);
    expect(model.tables[0]!.checks).toHaveLength(1);
  });

  it('does not strip parens that are two sibling groups, not one wrapper', async () => {
    // `(a) AND (b)` starts with '(' and ends with ')' but is NOT wrapped: the
    // depth returns to 0 before the end. Stripping blindly would turn it into
    // the corrupt `a) AND (b`.
    const exec = routed({
      tables: oneTable,
      columns: [col({ table_name: 't', column_name: 'total', column_type: 'int' })],
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [{ constraint_name: 'ck', check_clause: '(`total` > 0) and (`total` < 10)' }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.checks[0]!.expression).toBe('(`total` > 0) and (`total` < 10)');
  });

  it('strips every layer of genuinely nested wrapper parens', async () => {
    const exec = routed({
      tables: oneTable,
      columns: [col({ table_name: 't', column_name: 'total', column_type: 'int' })],
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [{ constraint_name: 'ck', check_clause: '(((`total` > 0)))' }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.tables[0]!.checks[0]!.expression).toBe('`total` > 0');
  });

  it('records a non-enum CHECK without inventing an enum', async () => {
    const exec = routed({
      tables: oneTable,
      columns: [col({ table_name: 't', column_name: 'total', column_type: 'int' })],
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [{ constraint_name: 'ck', check_clause: '(`total` > 0)' }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.enums).toEqual([]);
    expect(model.tables[0]!.checks[0]!.expression).toBe('`total` > 0');
  });

  it('does not synthesize an enum for a CHECK on an unknown column', async () => {
    const exec = routed({
      tables: oneTable,
      columns: tierColumn,
      tableConstraints: [{ table_name: 't', constraint_name: 'ck', constraint_type: 'CHECK' }],
      checkConstraints: [{ constraint_name: 'ck', check_clause: "(`ghost` in ('a','b'))" }],
    });
    const model = await introspectMysql(exec, CTX);
    expect(model.enums).toEqual([]);
    expect(model.tables[0]!.checks).toHaveLength(1);
  });
});

describe('introspectMysql — ordering', () => {
  it('sorts tables, columns, indexes and enums deterministically', async () => {
    const exec = routed({
      tables: [
        { table_name: 'zebra', table_type: 'BASE TABLE' },
        { table_name: 'alpha', table_type: 'BASE TABLE' },
      ],
      columns: [
        col({ table_name: 'zebra', column_name: 'second', ordinal: 2, column_type: "enum('b')" }),
        col({ table_name: 'zebra', column_name: 'first', ordinal: 1, column_type: "enum('a')" }),
      ],
      statistics: [
        { table_name: 'zebra', index_name: 'zzz', non_unique: 1, seq_in_index: 1, column_name: 'first' },
        { table_name: 'zebra', index_name: 'aaa', non_unique: 1, seq_in_index: 1, column_name: 'first' },
      ],
    });
    const model = await introspectMysql(exec, CTX);

    expect(model.tables.map((t) => t.name)).toEqual(['alpha', 'zebra']);
    const zebra = model.tables.find((t) => t.name === 'zebra')!;
    expect(zebra.columns.map((c) => c.name)).toEqual(['first', 'second']);
    expect(zebra.indexes.map((i) => i.name)).toEqual(['aaa', 'zzz']);
    expect(model.enums.map((e) => e.id)).toEqual([`${DB}.zebra.first`, `${DB}.zebra.second`]);
  });

  it('keeps both entries when two sort keys are equal', async () => {
    const exec = routed({
      tables: [{ table_name: 't', table_type: 'BASE TABLE' }],
      columns: [
        col({ table_name: 't', column_name: 'a', ordinal: 1 }),
        col({ table_name: 't', column_name: 'b', ordinal: 1 }),
      ],
    });
    const model = await introspectMysql(exec, CTX);
    // A comparator returning nonzero for equal keys could drop one.
    expect(model.tables[0]!.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });
});
