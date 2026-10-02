// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `dropColumns` — the narrow door for a column going from a table that stays.
 *
 * The validation half is refusals, each with a case that trips it and one
 * that does not. `tableWithDroppedColumns` is the planner's half: it must take
 * the column and the rules that cannot outlive it, and nothing else. The plan
 * cases pin the two things the door needs of the planner: a dropped link
 * carries its own name (it is in no desired document, so the compiler finds
 * it by that), and on SQLite a column under a constraint goes in the rebuild
 * that removes the constraint, never as an ALTER before it.
 *
 * The server runs the door against real databases on three engines; these pin
 * the rules, where a failure names the rule.
 */
import { describe, expect, it } from 'vitest';

import {
  isReservedWord,
  parseDatabaseModel,
  planDdl,
  tableWithAlteredColumns,
  tableWithDroppedColumns,
  validateSchemaEdit,
  type ColumnModel,
  type DatabaseModel,
  type EditValidationContext,
  type Relation,
  type SchemaEdit,
  type TableModel,
} from '../src/index.js';

const edit = (over: Partial<SchemaEdit> = {}): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  addColumns: [],
  alterColumns: [],
  dropTables: [],
  ...over,
});

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

const idx = (name: string, columns: string[], unique = false) => ({ name, columns, expression: null, unique, primary: false, method: null, partial: false });

const link: Relation = {
  id: 'fk:public.things(parent_id)->public.parents(id)',
  kind: 'declared-fk',
  cardinality: 'one-to-many',
  from: { tableId: 'public.things', columns: ['parent_id'] },
  to: { tableId: 'public.parents', columns: ['id'] },
  through: null,
  onDelete: null,
  onUpdate: null,
  selfReferential: false,
  confidence: 1,
  constraintName: 'fk_things_parent',
};

const THINGS = tbl({
  name: 'things',
  columns: [
    col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
    col({ name: 'title', ordinal: 2, nullable: false }),
    col({ name: 'code', ordinal: 3 }),
    col({ name: 'status', ordinal: 4 }),
    col({ name: 'colour', ordinal: 5 }),
    col({ name: 'parent_id', ordinal: 6, logicalType: 'integer' }),
  ],
  uniques: [{ name: 'uq_things_code', columns: ['code'] }],
  checks: [{ name: 'things_status_check', expression: "status in ('open', 'done')" }],
  indexes: [idx('ix_things_colour', ['colour']), idx('ix_things_title', ['title'])],
});
const PARENTS = tbl({ name: 'parents' });

const ctx = (over: Partial<EditValidationContext> = {}): EditValidationContext => ({
  dialect: 'postgres',
  maxIdentifierLength: 63,
  actual: [THINGS, PARENTS],
  relations: [link],
  metaSharesDatabase: false,
  isReserved: isReservedWord,
  ...over,
});

const codes = (issues: { code: string }[]): string[] => issues.map((issue) => issue.code);
const drop = (...entries: [string, string][]): SchemaEdit => edit({ dropColumns: entries.map(([table, column]) => ({ table, column })) });

describe('validating dropColumns', () => {
  it('takes a plain column, by the table’s id or its bare name', () => {
    expect(validateSchemaEdit(drop(['public.things', 'colour']), ctx())).toEqual([]);
    expect(validateSchemaEdit(drop(['things', 'colour'], ['things', 'code'], ['things', 'parent_id']), ctx())).toEqual([]);
  });

  it('refuses a column that is not there, and a table that is not', () => {
    expect(codes(validateSchemaEdit(drop(['things', 'nope']), ctx()))).toEqual(['UNKNOWN_COLUMN']);
    expect(codes(validateSchemaEdit(drop(['nothing', 'id']), ctx()))).toEqual(['UNKNOWN_TABLE']);
  });

  it('refuses a key column', () => {
    const issues = validateSchemaEdit(drop(['things', 'id']), ctx());
    expect(codes(issues)).toEqual(['COLUMN_IN_USE']);
    expect(issues[0]?.message).toContain('part of the key');
  });

  it('refuses a column another table links to, and takes it once nothing does', () => {
    const issues = validateSchemaEdit(drop(['parents', 'id']), ctx({ actual: [THINGS, tbl({ name: 'parents', primaryKey: [] })] }));
    expect(codes(issues)).toContain('COLUMN_IN_USE');
    expect(issues.some((issue) => issue.message.includes('public.things'))).toBe(true);
    const free = tbl({ name: 'parents', primaryKey: [], columns: [col({ name: 'id' }), col({ name: 'name', ordinal: 2 })] });
    expect(validateSchemaEdit(drop(['parents', 'id']), ctx({ actual: [THINGS, free], relations: [] }))).toEqual([]);
  });

  it('refuses to leave a table with no column', () => {
    const two = tbl({ name: 'pairs', primaryKey: [], columns: [col({ name: 'a' }), col({ name: 'b', ordinal: 2 })] });
    expect(validateSchemaEdit(drop(['pairs', 'a']), ctx({ actual: [two], relations: [] }))).toEqual([]);
    const issues = validateSchemaEdit(drop(['pairs', 'a'], ['pairs', 'b']), ctx({ actual: [two], relations: [] }));
    expect(issues.some((issue) => issue.code === 'COLUMN_IN_USE' && issue.message.includes('no column left'))).toBe(true);
  });

  it('refuses a table that the same edit restates whole', () => {
    const issues = validateSchemaEdit(
      edit({
        dropColumns: [{ table: 'things', column: 'colour' }],
        upsertTables: [{ id: 'public.things', schema: 'public', name: 'things', comment: null, columns: [], primaryKey: [], uniques: [], indexes: [], foreignKeys: [], enumValues: {} }] as never,
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('DUPLICATE_TABLE');
  });

  it('refuses Adminium’s own tables', () => {
    const own = tbl({ name: 'adminium_pages', columns: [col({ name: 'id' }), col({ name: 'slug', ordinal: 2 })] });
    expect(codes(validateSchemaEdit(drop(['adminium_pages', 'slug']), ctx({ actual: [own], metaSharesDatabase: true, relations: [] })))).toEqual(['META_NAMESPACE']);
  });
});

describe('the table without its dropped columns', () => {
  it('is the same table when nothing is dropped', () => {
    expect(tableWithDroppedColumns(THINGS, [])).toBe(THINGS);
  });

  it('loses the column and only the rules that name it', () => {
    const after = tableWithDroppedColumns(THINGS, ['code', 'colour', 'status']);
    expect(after.columns.map((c) => [c.name, c.ordinal])).toEqual([
      ['id', 1],
      ['title', 2],
      ['parent_id', 3],
    ]);
    expect(after.uniques).toEqual([]);
    expect(after.checks).toEqual([]);
    // The index over a column that stays is untouched.
    expect(after.indexes.map((i) => i.name)).toEqual(['ix_things_title']);
    expect(after.primaryKey).toEqual(['id']);
    // Every column that stays is the snapshot's own object: nothing about it can read as changed.
    expect(after.columns[1]).toEqual({ ...THINGS.columns[1], ordinal: 2 });
  });

  it('keeps a rule over a column whose name only contains the dropped one', () => {
    const table = tbl({
      name: 't',
      columns: [col({ name: 'id', isPrimaryKey: true, nullable: false }), col({ name: 'code', ordinal: 2 }), col({ name: 'code_2', ordinal: 3 })],
      checks: [{ name: 'c', expression: "code_2 in ('a', 'b')" }],
      uniques: [{ name: 'u', columns: ['code_2'] }],
    });
    const after = tableWithDroppedColumns(table, ['code']);
    expect(after.checks).toHaveLength(1);
    expect(after.uniques).toHaveLength(1);
  });

  it('keeps a value list that only names the dropped column as one of its values', () => {
    // A column called `open` beside a status whose values include "open", as each engine words the rule.
    for (const expression of ["status in ('open', 'done')", "((status)::text = ANY ((ARRAY['open'::character varying, 'done'::character varying])::text[]))", "(`status` in (_utf8mb4'open',_utf8mb4'done'))"]) {
      const table = tbl({
        name: 't',
        columns: [col({ name: 'id', isPrimaryKey: true, nullable: false }), col({ name: 'status', ordinal: 2 }), col({ name: 'open', ordinal: 3 })],
        checks: [{ name: 'c', expression }],
      });
      expect(tableWithDroppedColumns(table, ['open']).checks).toHaveLength(1);
      expect(tableWithDroppedColumns(table, ['status']).checks).toHaveLength(0);
    }
  });

  it('still takes a free-form rule that names the column outside a quoted value', () => {
    const table = tbl({
      name: 't',
      columns: [col({ name: 'id', isPrimaryKey: true, nullable: false }), col({ name: 'a', ordinal: 2 }), col({ name: 'b', ordinal: 3 })],
      checks: [{ name: 'c', expression: "a > 0 or b = 'a'" }],
    });
    expect(tableWithDroppedColumns(table, ['a']).checks).toHaveLength(0);
    expect(tableWithDroppedColumns(tbl({ ...table, checks: [{ name: 'c', expression: "b <> 'a'" }] }), ['a']).checks).toHaveLength(1);
  });
});

describe('a column that may be left empty from now on', () => {
  const relax = (column: string): SchemaEdit => edit({ alterColumns: [{ table: 'things', column, nullable: true }] });

  it('is taken for a plain column and refused for the key', () => {
    expect(validateSchemaEdit(relax('title'), ctx())).toEqual([]);
    expect(codes(validateSchemaEdit(relax('id'), ctx()))).toEqual(['COLUMN_IN_USE']);
  });

  it('is refused for a column the same edit drops', () => {
    const both = edit({ dropColumns: [{ table: 'things', column: 'title' }], alterColumns: [{ table: 'things', column: 'title', nullable: true }] });
    expect(codes(validateSchemaEdit(both, ctx()))).toEqual(['DUPLICATE_COLUMN']);
  });

  it('plans one step that loses nothing', () => {
    const desired = tableWithAlteredColumns(THINGS, [{ table: 'things', column: 'title', nullable: true }], { dbTypeFor: () => 'text' });
    expect(desired.columns.find((c) => c.name === 'title')?.nullable).toBe(true);
    const plan = planDdl({ dialect: 'postgres', serverVersion: '16.0', actual: model([THINGS, PARENTS], [link]), desired: [desired], desiredRelations: [link] });
    expect(plan.steps.map((s) => [s.kind, s.column])).toEqual([['drop-not-null', 'title']]);
    expect(plan.requiresSuperAdmin).toBe(false);
  });
});

const model = (tables: TableModel[], relations: Relation[] = [], dialect = 'postgres'): DatabaseModel =>
  parseDatabaseModel(JSON.stringify({ irVersion: 1, dialect, name: 't', tables, relations, enums: [] }));

describe('planning a dropped column', () => {
  const after = tableWithDroppedColumns(THINGS, ['code', 'colour', 'parent_id']);

  it('drops the rules first and names the link it drops, on postgres', () => {
    const plan = planDdl({ dialect: 'postgres', serverVersion: '16.0', actual: model([THINGS, PARENTS], [link]), desired: [after], desiredRelations: [] });
    expect(plan.steps.map((s) => [s.kind, s.column, s.constraint])).toEqual([
      ['drop-fk', 'parent_id', 'fk_things_parent'],
      ['drop-unique', null, 'uq_things_code'],
      ['drop-index', null, 'ix_things_colour'],
      ['drop-column', 'code', null],
      ['drop-column', 'colour', null],
      ['drop-column', 'parent_id', null],
    ]);
  });

  it('folds the columns into the rebuild on SQLite when a constraint goes with them, and says so', () => {
    const plan = planDdl({
      dialect: 'sqlite',
      serverVersion: '3.45.0',
      actual: model([THINGS, PARENTS], [link], 'sqlite'),
      desired: [after],
      desiredRelations: [],
    });
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds).toContain('rebuild-table');
    // The rebuild destroys the columns' data, so it is as guarded as a drop is: lossy, and Super Admin's alone.
    const rebuild = plan.steps.find((s) => s.kind === 'rebuild-table');
    expect(rebuild).toMatchObject({ hazard: 'lossy', requiresSuperAdmin: true });
    expect(rebuild?.summary).toContain('dropping code, colour, parent_id and their data');
    expect(plan.requiresSuperAdmin).toBe(true);
    // No ALTER that SQLite would refuse while the constraint still names the column.
    expect(kinds).not.toContain('drop-column');
    const said = plan.warnings.map((w) => w.message).join('\n');
    for (const name of ['code', 'colour', 'parent_id']) expect(said).toContain(`things.${name} and its data are dropped in the rebuild.`);
  });

  it('drops a plain column in place on SQLite, with no rebuild', () => {
    const plain = tbl({ name: 't', columns: [col({ name: 'id', isPrimaryKey: true, nullable: false }), col({ name: 'note', ordinal: 2 })] });
    const plan = planDdl({
      dialect: 'sqlite',
      serverVersion: '3.45.0',
      actual: model([plain], [], 'sqlite'),
      desired: [tableWithDroppedColumns(plain, ['note'])],
      desiredRelations: [],
    });
    expect(plan.steps.map((s) => [s.kind, s.column])).toEqual([['drop-column', 'note']]);
    expect(plan.requiresSuperAdmin).toBe(true);
  });

  it('keeps a rebuild that drops nothing a plain rewrite', () => {
    const before = tbl({
      name: 't',
      columns: [col({ name: 'id', isPrimaryKey: true, nullable: false }), col({ name: 'code', ordinal: 2 })],
      uniques: [{ name: 'uq_t_code', columns: ['code'] }],
    });
    const plan = planDdl({
      dialect: 'sqlite',
      serverVersion: '3.45.0',
      actual: model([before], [], 'sqlite'),
      desired: [{ ...before, uniques: [] }],
      desiredRelations: [],
    });
    expect(plan.steps.map((s) => [s.kind, s.hazard, s.requiresSuperAdmin])).toEqual([['rebuild-table', 'rewrite', false]]);
  });
});
