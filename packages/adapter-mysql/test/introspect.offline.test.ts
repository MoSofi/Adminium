/**
 * Offline introspection tests — the full assembly pipeline driven through a
 * canned-rows executor (no server, no driver), plus the SQL-text contract:
 * every statement in the fixed set references `information_schema`
 * exclusively (the "schema only" invariant, 05 §10) and is scoped to the
 * connected database. The live suite (adapter.live.test.ts) re-verifies the
 * same behavior against a real MySQL when TEST_MYSQL_URL is set.
 */
import { describe, expect, it } from 'vitest';

import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine/adapter';

import {
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
