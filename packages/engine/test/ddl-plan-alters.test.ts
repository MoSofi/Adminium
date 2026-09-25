// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every branch of the alter planner, the default validator and the forward
 * type map.
 *
 * These are the paths that decide what SQL runs against a customer's database,
 * so "it compiles" is not the bar. Each block below drives one class of change
 * end to end and asserts the step kinds, their order, and their hazard.
 */
import { describe, expect, it } from 'vitest';

import {
  applyRenames,
  ddlTypeFor,
  isReservedWord,
  parseDatabaseModel,
  planDdl,
  validateSchemaEdit,
  type ColumnModel,
  type DatabaseModel,
  type DesiredColumn,
  type DesiredTable,
  type Dialect,
  type EditValidationContext,
  type Relation,
  type SchemaEdit,
  type TableModel,
} from '../src/index.js';

// ---------------------------------------------------------------------------

const col = (over: Partial<ColumnModel> & { name: string }): ColumnModel => ({
  ordinal: 1,
  dbType: 'text',
  logicalType: 'text',
  nullable: true,
  default: null,
  isPrimaryKey: false,
  isUnique: false,
  isGenerated: false,
  enumRef: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  isArray: false,
  comment: null,
  references: null,
  semantics: null,
  ...over,
});

const tbl = (over: Partial<TableModel> & { name: string }): TableModel => ({
  id: `public.${over.name}`,
  schema: 'public',
  kind: 'table',
  comment: null,
  columns: [col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false })],
  primaryKey: ['id'],
  uniques: [],
  checks: [],
  indexes: [],
  rowCountEstimate: null,
  rowCountExact: false,
  sizeBytes: null,
  activity: null,
  rls: null,
  system: false,
  semantics: null,
  ...over,
});

const model = (tables: TableModel[], relations: Relation[] = []): DatabaseModel =>
  parseDatabaseModel(
    JSON.stringify({ irVersion: 1, dialect: 'postgres', name: 't', tables, relations, enums: [] }),
  );

const idx = (name: string, columns: string[], unique = false) => ({
  name,
  columns,
  expression: null,
  unique,
  primary: false,
  method: null,
  partial: false,
});

const fk = (over: Partial<Relation> = {}): Relation => ({
  id: 'fk:public.orders(customer_id)->public.customers(id)',
  kind: 'declared-fk',
  cardinality: 'one-to-many',
  from: { tableId: 'public.orders', columns: ['customer_id'] },
  to: { tableId: 'public.customers', columns: ['id'] },
  through: null,
  onDelete: null,
  onUpdate: null,
  selfReferential: false,
  confidence: 1,
  constraintName: 'orders_customer_id_fkey',
  ...over,
});

const pg = { dialect: 'postgres' as Dialect, serverVersion: '16.2' };
const kinds = (p: { steps: { kind: string }[] }) => p.steps.map((s) => s.kind);

// ---------------------------------------------------------------------------

describe('planAlters — constraints', () => {
  it('plans add-unique, add-check and add-index', () => {
    const before = model([tbl({ name: 't', columns: [col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }), col({ name: 'slug' })] })]);
    const after = [
      tbl({
        name: 't',
        columns: [col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }), col({ name: 'slug' })],
        uniques: [{ name: 'u_slug', columns: ['slug'] }],
        checks: [{ name: 'c_slug', expression: "slug in ('a')" }],
        indexes: [idx('i_slug', ['slug'])],
      }),
    ];
    const plan = planDdl({ ...pg, actual: before, desired: after });
    expect(kinds(plan)).toEqual(['add-unique', 'add-check', 'add-index']);
    expect(plan.hazard).toBe('locking');
  });

  it('plans the drop side and puts it before every add', () => {
    const withAll = tbl({
      name: 't',
      columns: [col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }), col({ name: 'slug' })],
      uniques: [{ name: 'u_slug', columns: ['slug'] }],
      checks: [{ name: 'c_slug', expression: "slug in ('a')" }],
      indexes: [idx('i_slug', ['slug'])],
    });
    const plan = planDdl({
      ...pg,
      actual: model([withAll]),
      desired: [tbl({ name: 't', columns: withAll.columns })],
    });
    expect(kinds(plan)).toEqual(['drop-unique', 'drop-check', 'drop-index']);
    expect(plan.hazard).toBe('safe');
    // The index goes by its own name, never one the compiler would have to guess.
    expect(plan.steps.find((step) => step.kind === 'drop-index')?.constraint).toBe('i_slug');
  });

  /*
   * B6. The constraint steps used to carry neither their column nor the
   * database's own name for the constraint, so the compiler had nothing to
   * name: `add-check` could not find the value list, and `drop-check` guessed
   * `ck_<table>` — a name no engine had ever assigned. Changing the allowed
   * values on an existing table was therefore un-appliable.
   */
  it('gives every check step its column and the constraint’s real name', () => {
    const columns = [
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
      col({ name: 'status', logicalType: 'enum' }),
      col({ name: 'status_id', logicalType: 'integer' }),
    ];
    const before = model([
      tbl({
        name: 't',
        columns,
        // As postgres renders its own CHECK — the shape the fallback has to read.
        checks: [
          {
            name: 'patients_status_check',
            expression: "((status)::text = ANY ((ARRAY['new'::character varying])::text[]))",
          },
        ],
      }),
    ]);
    const after = [
      tbl({ name: 't', columns, checks: [{ name: null, expression: 'status in ("new", "done")' }] }),
    ];
    const plan = planDdl({ ...pg, actual: before, desired: after });
    expect(kinds(plan)).toEqual(['drop-check', 'add-check']);

    const dropped = plan.steps[0]!;
    expect(dropped.constraint).toBe('patients_status_check');
    // `status`, not `status_id`: the longest matching column name wins.
    expect(dropped.column).toBe('status');

    const added = plan.steps[1]!;
    expect(added.column).toBe('status');
    expect(added.constraint).toBeNull();
    expect(added.summary).toContain('status');
  });

  /*
   * D23. Auto-increment is not a DEFAULT on any engine, so a `set-default` step
   * carrying it reached the compiler and threw `set-default with no default` —
   * "turn auto-increment on for this key" was reviewable and un-appliable.
   */
  it('plans auto-increment on an existing key as set-identity, not set-default', () => {
    const key = (over: Partial<ColumnModel> = {}) =>
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false, ...over });
    const plain = model([tbl({ name: 't', columns: [key()] })]);
    const generated = [tbl({ name: 't', columns: [key({ default: { kind: 'autoincrement' } })] })];

    const on = planDdl({ ...pg, actual: plain, desired: generated });
    expect(kinds(on)).toEqual(['set-identity']);
    expect(on.steps[0]?.column).toBe('id');
    expect(on.hazard).toBe('locking');

    // …and off again, without a second `drop-default` behind it: postgres
    // refuses DROP DEFAULT on an identity column, and MySQL would copy twice.
    const off = planDdl({ ...pg, actual: model([generated[0]!]), desired: [tbl({ name: 't', columns: [key()] })] });
    expect(kinds(off)).toEqual(['drop-identity']);

    // From generated to a real default: detach first, then set it.
    const toLiteral = planDdl({
      ...pg,
      actual: model([generated[0]!]),
      desired: [tbl({ name: 't', columns: [key({ default: { kind: 'literal', text: '0' } })] })],
    });
    expect(kinds(toLiteral)).toEqual(['drop-identity', 'set-default']);
  });

  it('plans a primary-key change as drop then set, in that order', () => {
    const before = model([
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'tenant_id', logicalType: 'integer', nullable: false }),
        ],
        primaryKey: ['id'],
      }),
    ]);
    const after = [
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'tenant_id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        ],
        primaryKey: ['id', 'tenant_id'],
      }),
    ];
    const plan = planDdl({ ...pg, actual: before, desired: after });
    expect(kinds(plan)).toEqual(['drop-pk', 'set-pk']);
    expect(plan.steps[1]?.summary).toContain('id, tenant_id');
  });

  it('plans a foreign key add and drop', () => {
    const customers = tbl({ name: 'customers' });
    const orders = tbl({
      name: 'orders',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'customer_id', logicalType: 'integer' }),
      ],
    });
    const added = planDdl({
      ...pg,
      actual: model([customers, orders]),
      desired: [orders],
      desiredRelations: [fk()],
    });
    expect(kinds(added)).toEqual(['add-fk']);
    expect(added.steps[0]?.summary).toContain('public.customers');

    const dropped = planDdl({
      ...pg,
      actual: model([customers, orders], [fk()]),
      desired: [orders],
      desiredRelations: [],
    });
    expect(kinds(dropped)).toEqual(['drop-fk']);
    expect(dropped.steps[0]?.summary).toContain('orders_customer_id_fkey');
  });

  it('plans a referential-action change as drop + re-add, because no ALTER form exists', () => {
    const customers = tbl({ name: 'customers' });
    const orders = tbl({
      name: 'orders',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'customer_id', logicalType: 'integer' }),
      ],
    });
    const plan = planDdl({
      ...pg,
      actual: model([customers, orders], [fk({ onDelete: 'cascade' })]),
      desired: [orders],
      desiredRelations: [fk({ onDelete: 'restrict' })],
    });
    expect(kinds(plan)).toEqual(['drop-fk', 'add-fk']);
    expect(plan.steps[1]?.summary).toContain('ON DELETE restrict');
  });

  it('plans a comment change on the table and on a column', () => {
    const before = model([
      tbl({ name: 't', comment: null, columns: [col({ name: 'a', comment: null })], primaryKey: [] }),
    ]);
    const after = [
      tbl({
        name: 't',
        comment: 'the table',
        columns: [col({ name: 'a', comment: 'the column' })],
        primaryKey: [],
      }),
    ];
    const plan = planDdl({ ...pg, actual: before, desired: after });
    expect(kinds(plan)).toEqual(['set-comment', 'set-table-comment']);
  });

  it('plans nullability and default changes independently', () => {
    const before = model([
      tbl({ name: 't', columns: [col({ name: 'a', nullable: true, default: null })], primaryKey: [] }),
    ]);
    const after = [
      tbl({
        name: 't',
        columns: [col({ name: 'a', nullable: false, default: { kind: 'literal', text: 'x' } })],
        primaryKey: [],
      }),
    ];
    const plan = planDdl({ ...pg, actual: before, desired: after });
    expect(kinds(plan)).toEqual(['set-not-null', 'set-default']);
  });

  it('plans a default removal as drop-default', () => {
    const before = model([
      tbl({ name: 't', columns: [col({ name: 'a', default: { kind: 'literal', text: 'x' } })], primaryKey: [] }),
    ]);
    const after = [tbl({ name: 't', columns: [col({ name: 'a', default: null })], primaryKey: [] })];
    expect(kinds(planDdl({ ...pg, actual: before, desired: after }))).toEqual(['drop-default']);
  });

  it('plans a drop-not-null', () => {
    const before = model([tbl({ name: 't', columns: [col({ name: 'a', nullable: false })], primaryKey: [] })]);
    const after = [tbl({ name: 't', columns: [col({ name: 'a', nullable: true })], primaryKey: [] })];
    expect(kinds(planDdl({ ...pg, actual: before, desired: after }))).toEqual(['drop-not-null']);
  });

  it('emits nothing for an unchanged table', () => {
    const t = tbl({ name: 't' });
    expect(planDdl({ ...pg, actual: model([t]), desired: [t] }).steps).toEqual([]);
  });

  it('plans a column rename as its own step, before the table’s other changes', () => {
    const before = model([tbl({ name: 't', columns: [col({ name: 'old_name' })], primaryKey: [] })]);
    const { model: renamed, applied } = applyRenames(before, {
      tables: [],
      columns: [{ table: 'public.t', from: 'old_name', to: 'new_name' }],
    });
    const plan = planDdl({
      ...pg,
      actual: renamed,
      desired: [
        tbl({
          name: 't',
          columns: [col({ name: 'new_name' }), col({ name: 'extra' })],
          primaryKey: [],
        }),
      ],
      renames: applied,
    });
    expect(kinds(plan)).toEqual(['rename-column', 'add-column']);
    // The step carries BOTH names. The compiler used to guess the new one as
    // "the first desired column that is not the old one" — here `new_name`
    // only because it happens to come first; `id` on almost every real table.
    const rename = plan.steps.find((step) => step.kind === 'rename-column');
    expect(rename).toMatchObject({ column: 'old_name', renameTo: 'new_name' });
  });
});

describe('literal defaults are validated per type (D30)', () => {
  const base = (logicalType: DesiredColumn['logicalType'], text: string): SchemaEdit => ({
    baseSnapshotId: 's',
    renames: { tables: [], columns: [] },
    dropTables: [],
    upsertTables: [
      {
        id: null,
        schema: null,
        name: 'x',
        comment: null,
        columns: [
          {
            name: 'c',
            logicalType,
            nullable: true,
            default: { kind: 'literal', text },
            maxLength: null,
            numericPrecision: null,
            numericScale: null,
            comment: null,
          },
        ],
        primaryKey: [],
        uniques: [],
        indexes: [],
        foreignKeys: [],
        enumValues: logicalType === 'enum' ? { c: ['a'] } : {},
      } as DesiredTable,
    ],
  });

  const ctx: EditValidationContext = {
    dialect: 'postgres',
    maxIdentifierLength: 63,
    actual: [],
    metaSharesDatabase: false,
    isReserved: isReservedWord,
  };

  const ok = (t: DesiredColumn['logicalType'], v: string) =>
    validateSchemaEdit(base(t, v), ctx).filter((i) => i.code === 'INVALID_DEFAULT_LITERAL');

  it.each([
    ['integer', '42', true],
    ['integer', '-7', true],
    ['integer', '4.2', false],
    ['bigint', '9007199254740993', true],
    ['decimal', '10.50', true],
    ['decimal', 'abc', false],
    ['float', '1.5', true],
    ['boolean', 'true', true],
    ['boolean', 'yes', false],
    ['date', '2026-09-03', true],
    ['date', '03/09/2026', false],
    ['time', '13:45', true],
    ['time', 'noon', false],
    ['timestamp', '2026-09-03T13:45:00', true],
    ['timestamptz', '2026-09-03 13:45', true],
    ['timestamptz', 'later', false],
    ['uuid', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', true],
    ['uuid', 'not-a-uuid', false],
    ['json', '{"a":1}', true],
    ['json', '{oops', false],
    ['text', 'anything at all', true],
    ['varchar', 'anything at all', true],
    ['enum', 'a', true],
  ] as const)('%s default %j valid=%s', (type, value, valid) => {
    expect(ok(type, value)).toHaveLength(valid ? 0 : 1);
  });

  it('restricts autoincrement to integer keys and now() to temporal columns', () => {
    const withKind = (logicalType: DesiredColumn['logicalType'], kind: 'now' | 'uuid' | 'autoincrement') => {
      const e = base(logicalType, 'x');
      e.upsertTables[0]!.columns[0]!.default = { kind };
      return validateSchemaEdit(e, ctx).filter((i) => i.code === 'UNSUPPORTED_DEFAULT');
    };
    expect(withKind('integer', 'autoincrement')).toHaveLength(0);
    expect(withKind('bigint', 'autoincrement')).toHaveLength(0);
    expect(withKind('text', 'autoincrement')).toHaveLength(1);
    expect(withKind('timestamptz', 'now')).toHaveLength(0);
    expect(withKind('date', 'now')).toHaveLength(0);
    expect(withKind('integer', 'now')).toHaveLength(1);
    expect(withKind('uuid', 'uuid')).toHaveLength(0);
    expect(withKind('text', 'uuid')).toHaveLength(0);
    expect(withKind('integer', 'uuid')).toHaveLength(1);
  });
});

describe('the forward type map covers every authorable type on every dialect', () => {
  const TYPES = [
    'text', 'varchar', 'integer', 'bigint', 'decimal', 'float', 'boolean',
    'date', 'time', 'timestamp', 'timestamptz', 'uuid', 'json', 'enum',
  ] as const;

  it.each(['postgres', 'mysql', 'sqlite'] as const)('%s', (dialect) => {
    for (const logicalType of TYPES) {
      const emitted = ddlTypeFor({ logicalType }, dialect);
      expect(emitted, `${dialect}/${logicalType}`).toMatch(/^[a-z]/);
      expect(emitted.length, `${dialect}/${logicalType}`).toBeGreaterThan(2);
    }
  });

  it('spells the dialect-specific cases the way each engine wants', () => {
    expect(ddlTypeFor({ logicalType: 'float' }, 'sqlite')).toBe('real');
    expect(ddlTypeFor({ logicalType: 'float' }, 'postgres')).toBe('double precision');
    expect(ddlTypeFor({ logicalType: 'boolean' }, 'postgres')).toBe('boolean');
    expect(ddlTypeFor({ logicalType: 'boolean' }, 'sqlite')).toBe('integer');
    expect(ddlTypeFor({ logicalType: 'timestamp' }, 'mysql')).toBe('datetime');
    expect(ddlTypeFor({ logicalType: 'timestamp' }, 'sqlite')).toBe('timestamp');
    expect(ddlTypeFor({ logicalType: 'json' }, 'mysql')).toBe('json');
    expect(ddlTypeFor({ logicalType: 'json' }, 'sqlite')).toBe('text');
    expect(ddlTypeFor({ logicalType: 'uuid' }, 'sqlite')).toBe('text');
    expect(ddlTypeFor({ logicalType: 'date' }, 'sqlite')).toBe('date');
    expect(ddlTypeFor({ logicalType: 'time' }, 'mysql')).toBe('time');
    expect(ddlTypeFor({ logicalType: 'bigint' }, 'postgres')).toBe('bigint');
    expect(ddlTypeFor({ logicalType: 'integer' }, 'mysql')).toBe('integer');
    expect(ddlTypeFor({ logicalType: 'text' }, 'mysql')).toBe('text');
  });
});

describe('applyRenames covers the reference-rewriting paths', () => {
  it('rewrites a through-table join in a many-to-many relation', () => {
    const a = tbl({ name: 'a' });
    const b = tbl({ name: 'b' });
    const join = tbl({
      name: 'a_b',
      columns: [
        col({ name: 'a_id', logicalType: 'integer', references: { tableId: 'public.a', column: 'id' } }),
        col({ name: 'b_id', logicalType: 'integer', references: { tableId: 'public.b', column: 'id' } }),
      ],
      primaryKey: [],
    });
    const m2m: Relation = {
      id: 'inferred-m2m:public.a_b(a_id+b_id)',
      kind: 'inferred-join-table',
      cardinality: 'many-to-many',
      from: { tableId: 'public.a', columns: ['id'] },
      to: { tableId: 'public.b', columns: ['id'] },
      through: { tableId: 'public.a_b', fromColumns: ['a_id'], toColumns: ['b_id'] },
      onDelete: null,
      onUpdate: null,
      selfReferential: false,
      confidence: 0.8,
      constraintName: null,
    };
    const { model: renamed } = applyRenames(model([a, b, join], [m2m]), {
      tables: [{ from: 'public.a_b', to: 'a_to_b' }],
      columns: [],
    });
    expect(renamed.relations[0]?.through?.tableId).toBe('public.a_to_b');
    expect(renamed.tables.map((t) => t.name)).toContain('a_to_b');
  });

  it('rewrites a check-sourced enum id when its column is renamed', () => {
    const withEnum = parseDatabaseModel(
      JSON.stringify({
        irVersion: 1,
        dialect: 'postgres',
        name: 't',
        tables: [
          {
            id: 'public.t',
            schema: 'public',
            name: 't',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'state', logicalType: 'enum', enumRef: 'public.t.state' },
            ],
            primaryKey: ['id'],
          },
        ],
        relations: [],
        enums: [{ id: 'public.t.state', name: 'state', values: ['a', 'b'], source: 'check' }],
      }),
    );
    const { model: renamed } = applyRenames(withEnum, {
      tables: [],
      columns: [{ table: 'public.t', from: 'state', to: 'status' }],
    });
    expect(renamed.enums[0]?.id).toBe('public.t.status');
    expect(renamed.tables[0]?.columns[1]?.enumRef).toBe('public.t.status');
  });

  it('skips a column rename whose source column does not exist', () => {
    const { applied } = applyRenames(model([tbl({ name: 't' })]), {
      tables: [],
      columns: [{ table: 'public.t', from: 'nope', to: 'x' }],
    });
    expect(applied).toEqual([]);
  });

  it('skips a table rename that would be a no-op', () => {
    const { applied } = applyRenames(model([tbl({ name: 't' })]), {
      tables: [{ from: 'public.t', to: 't' }],
      columns: [],
    });
    expect(applied).toEqual([]);
  });

  it('resolves a table by bare name as well as by qualified id', () => {
    const { applied } = applyRenames(model([tbl({ name: 't' })]), {
      tables: [{ from: 't', to: 'u' }],
      columns: [],
    });
    expect(applied[0]?.to).toBe('u');
  });
});
