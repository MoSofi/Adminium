// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `alterColumns`, and the link column `addColumns` may carry — the two doors an
 * app update adapts a table it already has through.
 *
 * Every statement in the validation half is a REFUSAL, so each rule gets a case
 * that trips it and a case that does not: an untriggered refusal is a rule
 * that could be deleted with the suite still green. The server's install
 * pipeline runs these paths end to end on three engines; these cases pin the
 * rules themselves, where a failure names the rule rather than a migration.
 *
 * `tableWithAlteredColumns` is the planner's half: it must touch ONLY what was
 * asked, and an added enum value must land in the CHECK without dropping the
 * values already there.
 */
import { describe, expect, it } from 'vitest';

import {
  isReservedWord,
  isWideningChange,
  tableWithAlteredColumns,
  validateSchemaEdit,
  type AlterColumn,
  type DesiredColumn,
  type EditValidationContext,
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

const col = (name: string, logicalType: string, over: Record<string, unknown> = {}) =>
  ({
    name,
    logicalType,
    isPrimaryKey: false,
    nullable: true,
    default: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    ...over,
  }) as never;

/** `tickets`: an int key, a code, a status held to its values by a CHECK, a note. */
const tickets = (over: Partial<EditValidationContext['actual'][number]> = {}) => ({
  id: 'public.tickets',
  schema: 'public',
  name: 'tickets',
  kind: 'table' as const,
  system: false,
  columns: [
    col('id', 'integer', { isPrimaryKey: true, nullable: false }),
    col('code', 'varchar', { maxLength: 12 }),
    col('status', 'varchar', { maxLength: 32 }),
    col('total', 'decimal', { numericPrecision: 10, numericScale: 2 }),
  ],
  primaryKey: ['id'],
  checks: [{ name: 'tickets_status_check', expression: "status in ('open', 'paid')" }] as never,
  ...over,
});

const customers = {
  id: 'public.customers',
  schema: 'public',
  name: 'customers',
  kind: 'table' as const,
  system: false,
  columns: [col('id', 'integer', { isPrimaryKey: true, nullable: false })],
  primaryKey: ['id'],
};

const ctx = (over: Partial<EditValidationContext> = {}): EditValidationContext => ({
  dialect: 'postgres',
  maxIdentifierLength: 63,
  actual: [tickets(), customers],
  metaSharesDatabase: false,
  isReserved: isReservedWord,
  isWidening: isWideningChange,
  ...over,
});

const alter = (over: Partial<AlterColumn> & { column: string }): AlterColumn => ({ table: 'public.tickets', ...over });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();

describe('alterColumns — what it may change', () => {
  it('accepts a widening, an identity on the integer key and an added value', () => {
    const issues = validateSchemaEdit(
      edit({
        alterColumns: [
          alter({ column: 'code', widen: { logicalType: 'varchar', maxLength: 40 } }),
          alter({ column: 'id', identity: true }),
          alter({ column: 'status', enumValues: ['refunded'] }),
        ],
      }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });

  it('addresses the table by its bare name too', () => {
    const issues = validateSchemaEdit(
      edit({ alterColumns: [alter({ table: 'tickets', column: 'code', widen: { logicalType: 'text' } })] }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });

  it('refuses a narrowing as NOT_WIDENING', () => {
    const issues = validateSchemaEdit(
      edit({ alterColumns: [alter({ column: 'code', widen: { logicalType: 'varchar', maxLength: 4 } })] }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['NOT_WIDENING']);
    expect(issues[0]).toMatchObject({ table: 'public.tickets', column: 'code' });
  });

  it('refuses every widening when no widening check is injected', () => {
    const issues = validateSchemaEdit(
      edit({ alterColumns: [alter({ column: 'code', widen: { logicalType: 'text' } })] }),
      ctx({ isWidening: undefined }),
    );
    expect(codes(issues)).toEqual(['NOT_WIDENING']);
  });

  it('refuses identity on anything but the single integer key', () => {
    const onCode = validateSchemaEdit(edit({ alterColumns: [alter({ column: 'code', identity: true })] }), ctx());
    expect(codes(onCode)).toEqual(['IDENTITY_NOT_A_KEY']);

    const textKey = tickets({ columns: [col('id', 'text', { isPrimaryKey: true, nullable: false })] });
    const onTextKey = validateSchemaEdit(
      edit({ alterColumns: [alter({ column: 'id', identity: true })] }),
      ctx({ actual: [textKey, customers] }),
    );
    expect(codes(onTextKey)).toEqual(['IDENTITY_NOT_A_KEY']);
  });

  it('refuses new values for a column with no value list', () => {
    const issues = validateSchemaEdit(edit({ alterColumns: [alter({ column: 'code', enumValues: ['x'] })] }), ctx());
    expect(codes(issues)).toEqual(['ENUM_ON_NON_ENUM_COLUMN']);

    const noChecks = validateSchemaEdit(
      edit({ alterColumns: [alter({ column: 'status', enumValues: ['x'] })] }),
      ctx({ actual: [tickets({ checks: undefined }), customers] }),
    );
    expect(codes(noChecks)).toEqual(['ENUM_ON_NON_ENUM_COLUMN']);
  });

  it('refuses a column the table does not have', () => {
    const issues = validateSchemaEdit(edit({ alterColumns: [alter({ column: 'gone', identity: true })] }), ctx());
    expect(codes(issues)).toEqual(['UNKNOWN_COLUMN']);
  });

  it('refuses a table that is also restated by upsertTables', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          {
            id: 'public.tickets',
            schema: 'public',
            name: 'tickets',
            comment: null,
            columns: [],
            primaryKey: ['id'],
            uniques: [],
            indexes: [],
            foreignKeys: [],
            enumValues: {},
          } as never,
        ],
        alterColumns: [alter({ column: 'code', widen: { logicalType: 'text' } })],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('DUPLICATE_TABLE');
  });

  it('reports a table that is not there once, and checks nothing else about it', () => {
    const issues = validateSchemaEdit(
      edit({ alterColumns: [alter({ table: 'public.gone', column: 'code', identity: true })] }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['UNKNOWN_TABLE']);
  });
});

describe('addColumns — a column that links to another table', () => {
  const linkColumn = (over: Partial<DesiredColumn> = {}): DesiredColumn => ({
    name: 'customer_id',
    logicalType: 'integer',
    nullable: true,
    default: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    comment: null,
    ...over,
  });
  const addLink = (column: DesiredColumn, toTable = 'public.customers', toColumns = ['id']) => ({
    table: 'public.tickets',
    column,
    foreignKey: { toTable, toColumns, onDelete: null },
  });

  it('accepts a nullable link with no default to a real key', () => {
    expect(validateSchemaEdit(edit({ addColumns: [addLink(linkColumn())] }), ctx())).toEqual([]);
    expect(validateSchemaEdit(edit({ addColumns: [addLink(linkColumn(), 'customers')] }), ctx())).toEqual([]);
  });

  it('refuses a link that is not nullable, or that has a default', () => {
    const notNull = validateSchemaEdit(edit({ addColumns: [addLink(linkColumn({ nullable: false }))] }), ctx());
    expect(codes(notNull)).toContain('FK_COLUMN_NOT_NULLABLE');

    const withDefault = validateSchemaEdit(
      edit({ addColumns: [addLink(linkColumn({ default: { kind: 'literal', text: '1' } } as never))] }),
      ctx(),
    );
    expect(codes(withDefault)).toContain('FK_COLUMN_NOT_NULLABLE');
  });

  it('refuses a link to a table that is not there', () => {
    const issues = validateSchemaEdit(edit({ addColumns: [addLink(linkColumn(), 'public.nowhere')] }), ctx());
    expect(codes(issues)).toEqual(['UNKNOWN_TABLE']);
    expect(issues[0]?.message).toContain('public.nowhere');
  });

  it('refuses a link to a column the target lacks, or to more than one column', () => {
    const missing = validateSchemaEdit(edit({ addColumns: [addLink(linkColumn(), 'public.customers', ['uuid'])] }), ctx());
    expect(codes(missing)).toEqual(['UNKNOWN_COLUMN']);

    const two = validateSchemaEdit(edit({ addColumns: [addLink(linkColumn(), 'public.customers', ['id', 'id'])] }), ctx());
    expect(codes(two)).toEqual(['UNKNOWN_COLUMN']);
  });
});

describe('a boolean default as MySQL reads it back', () => {
  it('is a boolean literal: `1` and `0` restate a `tinyint(1)` default', () => {
    const flag = (text: string) => ({
      table: 'public.tickets',
      column: { name: 'flagged', logicalType: 'boolean' as const, nullable: true, default: { kind: 'literal' as const, text }, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
    });
    expect(validateSchemaEdit(edit({ addColumns: [flag('0'), { ...flag('1'), column: { ...flag('1').column, name: 'held' } }] }), ctx({ dialect: 'mysql' }))).toEqual([]);
    expect(codes(validateSchemaEdit(edit({ addColumns: [flag('2')] }), ctx({ dialect: 'mysql' })))).toEqual(['INVALID_DEFAULT_LITERAL']);
  });
});

describe('addColumns — a column whose values must all differ', () => {
  const column = (over: Partial<DesiredColumn> = {}): DesiredColumn => ({
    name: 'ref_no',
    logicalType: 'varchar',
    nullable: true,
    default: null,
    maxLength: 20,
    numericPrecision: null,
    numericScale: null,
    comment: null,
    ...over,
  });
  const add = (c: DesiredColumn) => ({ table: 'public.tickets', column: c, unique: true });

  it('accepts one with no default: every row already there starts empty', () => {
    expect(validateSchemaEdit(edit({ addColumns: [add(column())] }), ctx())).toEqual([]);
    expect(validateSchemaEdit(edit({ addColumns: [add(column())] }), ctx({ dialect: 'mysql' }))).toEqual([]);
  });

  it('refuses one that would start every existing row on the same default', () => {
    const issues = validateSchemaEdit(edit({ addColumns: [add(column({ default: { kind: 'literal', text: 'R-1' } } as never))] }), ctx());
    expect(codes(issues)).toEqual(['UNSUPPORTED_DEFAULT']);
    expect(issues[0]?.message).toContain('cannot start every existing row on the same default');
  });

  it('refuses unlimited text on MySQL, which cannot keep it unique', () => {
    const text = column({ logicalType: 'text', maxLength: null });
    expect(codes(validateSchemaEdit(edit({ addColumns: [add(text)] }), ctx({ dialect: 'mysql' })))).toEqual(['UNSUPPORTED_TYPE']);
    expect(validateSchemaEdit(edit({ addColumns: [add(text)] }), ctx())).toEqual([]);
  });

  it('refuses text wider than MySQL can index, 768 characters, before the column goes in without its rule', () => {
    expect(validateSchemaEdit(edit({ addColumns: [add(column({ maxLength: 768 }))] }), ctx({ dialect: 'mysql' }))).toEqual([]);
    const issues = validateSchemaEdit(edit({ addColumns: [add(column({ maxLength: 1000 }))] }), ctx({ dialect: 'mysql' }));
    expect(codes(issues)).toEqual(['UNSUPPORTED_TYPE']);
    expect(issues[0]?.message).toContain('768 characters');
    expect(validateSchemaEdit(edit({ addColumns: [add(column({ maxLength: 1000 }))] }), ctx())).toEqual([]);
  });

  it('is unique with a parent row it names, which must be there or added beside it', () => {
    const number = column({ name: 'v', logicalType: 'integer', maxLength: null });
    expect(validateSchemaEdit(edit({ addColumns: [{ ...add(number), uniqueWith: ['code'] }] }), ctx())).toEqual([]);
    expect(codes(validateSchemaEdit(edit({ addColumns: [{ ...add(number), uniqueWith: ['nope'] }] }), ctx()))).toEqual(['UNKNOWN_COLUMN']);
    const parent = { table: 'public.tickets', column: column({ name: 'parent_id', logicalType: 'integer', maxLength: null }) };
    expect(validateSchemaEdit(edit({ addColumns: [parent, { ...add(number), uniqueWith: ['parent_id'] }] }), ctx())).toEqual([]);
    // Partners without the rule itself name nothing.
    expect(codes(validateSchemaEdit(edit({ addColumns: [{ table: 'public.tickets', column: number, uniqueWith: ['code'] }] }), ctx()))).toEqual(['UNKNOWN_COLUMN']);
  });
});

describe('alterColumns — the unique rule a column is declared with, given to one that lacks it', () => {
  it('accepts it on a column there, alone or with its parent row', () => {
    expect(validateSchemaEdit(edit({ alterColumns: [alter({ column: 'code', unique: true })] }), ctx({ dialect: 'mysql' }))).toEqual([]);
    expect(validateSchemaEdit(edit({ alterColumns: [alter({ column: 'total', unique: true, uniqueWith: ['status'] })] }), ctx())).toEqual([]);
    expect(codes(validateSchemaEdit(edit({ alterColumns: [alter({ column: 'total', unique: true, uniqueWith: ['nope'] })] }), ctx()))).toEqual(['UNKNOWN_COLUMN']);
  });

  it('refuses it where MySQL could not keep it: unlimited text, or text wider than 768 characters', () => {
    const wide = ctx({ dialect: 'mysql', actual: [tickets({ columns: [col('id', 'integer', { isPrimaryKey: true }), col('note', 'varchar', { maxLength: 1000 }), col('body', 'text')] }), customers] });
    expect(codes(validateSchemaEdit(edit({ alterColumns: [alter({ column: 'note', unique: true }), alter({ column: 'body', unique: true })] }), wide))).toEqual([
      'UNSUPPORTED_TYPE',
      'UNSUPPORTED_TYPE',
    ]);
    expect(validateSchemaEdit(edit({ alterColumns: [alter({ column: 'note', unique: true })] }), { ...wide, dialect: 'postgres' })).toEqual([]);
  });
});

describe('tableWithAlteredColumns', () => {
  const model = (): TableModel =>
    ({
      ...tickets(),
      columns: [
        col('id', 'integer', { isPrimaryKey: true, nullable: false, dbType: 'integer' }),
        col('code', 'varchar', { maxLength: 12, dbType: 'varchar(12)' }),
        col('status', 'varchar', { maxLength: 32, dbType: 'varchar(32)' }),
        col('total', 'decimal', { numericPrecision: 10, numericScale: 2, dbType: 'numeric(10,2)' }),
      ],
      checks: [
        { name: 'tickets_status_check', expression: "status in ('open', 'paid')" },
        { name: 'tickets_total_check', expression: 'total >= 0' },
      ],
    }) as never;
  const dbTypeFor = (c: DesiredColumn) => (c.maxLength === null ? c.logicalType : `${c.logicalType}(${c.maxLength})`);

  it('changes only the columns named, and leaves the rest as the snapshot has them', () => {
    const before = model();
    const after = tableWithAlteredColumns(
      before,
      [
        alter({ column: 'code', widen: { logicalType: 'varchar', maxLength: 40 } }),
        alter({ column: 'id', identity: true }),
      ],
      { dbTypeFor },
    );
    const byName = new Map(after.columns.map((c) => [c.name, c]));
    expect(byName.get('code')).toMatchObject({ logicalType: 'varchar', maxLength: 40, dbType: 'varchar(40)' });
    expect(byName.get('id')?.default).toEqual({ kind: 'autoincrement' });
    expect(byName.get('status')).toBe(before.columns[2]);
    expect(byName.get('total')).toBe(before.columns[3]);
    expect(after.checks).toEqual(before.checks);
  });

  it('widens without a length when none is given', () => {
    const after = tableWithAlteredColumns(model(), [alter({ column: 'code', widen: { logicalType: 'text' } })], { dbTypeFor });
    expect(after.columns[1]).toMatchObject({ logicalType: 'text', maxLength: null, dbType: 'text' });
  });

  it('gives a column the unique rule under the installer’s name: a constraint, or an index made in place', () => {
    const asked = [alter({ column: 'code', unique: true }), alter({ column: 'total', unique: true, uniqueWith: ['status'] })];
    const bare = (): TableModel => ({ ...model(), uniques: [], indexes: [] });
    const constraint = tableWithAlteredColumns(bare(), asked, { dbTypeFor });
    expect(constraint.uniques).toEqual([
      { name: 'uq_tickets_code', columns: ['code'] },
      { name: 'uq_tickets_total', columns: ['status', 'total'] },
    ]);
    expect(constraint.columns).toEqual(model().columns);
    const index = tableWithAlteredColumns(bare(), asked, { dbTypeFor, uniqueAs: 'index' });
    expect(index.uniques).toEqual([]);
    expect(index.indexes.map((i) => [i.name, i.columns, i.unique])).toEqual([
      ['uq_tickets_code', ['code'], true],
      ['uq_tickets_total', ['status', 'total'], true],
    ]);
  });

  it("adds values to the CHECK, keeps the old ones first, the constraint's name, and no duplicates", () => {
    const after = tableWithAlteredColumns(model(), [alter({ column: 'status', enumValues: ['paid', 'refunded'] })], {
      dbTypeFor,
    });
    expect(after.checks[0]).toEqual({ name: 'tickets_status_check', expression: 'status in ("open", "paid", "refunded")' });
    expect(after.checks[1]).toEqual({ name: 'tickets_total_check', expression: 'total >= 0' });
  });
});

describe('isWideningChange — integer into decimal', () => {
  const shape = (logicalType: string, over: Record<string, unknown> = {}) =>
    ({ logicalType, maxLength: null, numericPrecision: null, numericScale: null, ...over }) as never;

  it('widens only when the decimal keeps every integer digit', () => {
    expect(isWideningChange(shape('integer'), shape('decimal', { numericPrecision: 12, numericScale: 2 }))).toBe(true);
    expect(isWideningChange(shape('integer'), shape('decimal', { numericPrecision: 10, numericScale: 2 }))).toBe(false);
    expect(isWideningChange(shape('bigint'), shape('decimal', { numericPrecision: 19, numericScale: 4 }))).toBe(false);
    expect(isWideningChange(shape('bigint'), shape('decimal', { numericPrecision: 23, numericScale: 4 }))).toBe(true);
  });

  it('never calls float into decimal a widening', () => {
    expect(isWideningChange(shape('float'), shape('decimal', { numericPrecision: 38, numericScale: 0 }))).toBe(false);
  });
});
