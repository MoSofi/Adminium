// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addColumns` — the gates on the narrow door.
 *
 * `test/ddl-edit.test.ts` exercises `validateSchemaEdit` through `upsertTables`.
 * The tail of that function — the loop that guards the OTHER door, the one an
 * attachment column arrives through — was reached by no test at all. That is
 * worse than an ordinary coverage hole: every statement in this loop is a
 * REFUSAL, so an untriggered one is a rule that could be deleted today and
 * leave the suite green.
 *
 * Two of the rules exist only on this path, and each has its own case below:
 * the table must already be in the snapshot (a column-level document has
 * nothing to create), and it must not ALSO be restated by `upsertTables` in the
 * same edit — two descriptions of one table is a plan whose outcome depends on
 * which one the planner reaches first.
 *
 * The rest are the upsert path's own gates re-asserted here, which is the point
 * of testing them twice: the narrow door is a second entrance, and a second
 * entrance is how an identifier or a type that the designer refuses gets in.
 */
import { describe, expect, it } from 'vitest';

import {
  isReservedWord,
  validateSchemaEdit,
  type DesiredColumn,
  type DesiredTable,
  type EditIssue,
  type EditValidationContext,
  type SchemaEdit,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures — the smallest snapshot that can answer these questions: one real
// table, two columns, a single-column key.
// ---------------------------------------------------------------------------

const column = (over: Partial<DesiredColumn> = {}): DesiredColumn => ({
  name: 'phone',
  logicalType: 'text',
  nullable: true,
  default: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  comment: null,
  ...over,
});

const edit = (over: Partial<SchemaEdit> = {}): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  addColumns: [],
  dropTables: [],
  ...over,
});

const actualTable = (over: Partial<EditValidationContext['actual'][number]> = {}) => ({
  id: 'public.customers',
  schema: 'public',
  name: 'customers',
  kind: 'table' as const,
  system: false,
  columns: [
    { name: 'id', isPrimaryKey: true } as never,
    { name: 'email', isPrimaryKey: false } as never,
  ],
  primaryKey: ['id'],
  ...over,
});

/** A restatement of the same table through the WIDE door, for the clash cases. */
const desiredCustomers = (over: Partial<DesiredTable> = {}): DesiredTable => ({
  id: 'public.customers',
  schema: 'public',
  name: 'customers',
  comment: null,
  columns: [column({ name: 'id', logicalType: 'integer', nullable: false })],
  primaryKey: ['id'],
  uniques: [],
  indexes: [],
  foreignKeys: [],
  enumValues: {},
  ...over,
});

const ctx = (over: Partial<EditValidationContext> = {}): EditValidationContext => ({
  dialect: 'postgres',
  maxIdentifierLength: 63,
  actual: [actualTable()],
  metaSharesDatabase: false,
  isReserved: isReservedWord,
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();
const withCode = (issues: EditIssue[], code: string) => issues.filter((i) => i.code === code);

/** One `addColumns` entry against the fixture table, addressed by id. */
const add = (over: Partial<DesiredColumn> = {}, table = 'public.customers') => ({
  table,
  column: column(over),
});

// ---------------------------------------------------------------------------

describe('addColumns — the table it names', () => {
  it('refuses a table that is not in the active snapshot, and looks no further', () => {
    // The stale-plan case again, through the other door: the tab was open when
    // the table still existed. `interval` would be a second refusal if the loop
    // kept going, so its absence is what proves the entry is abandoned.
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'note', logicalType: 'interval' }, 'public.gone')] }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['UNKNOWN_TABLE']);
    expect(issues[0]?.table).toBe('public.gone');
    expect(issues[0]?.message).toContain('is not in the active snapshot');
  });

  it('refuses a system table — the narrow door is not a way around SYSTEM_TABLE', () => {
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'note' }, 'public.adminium_users')] }),
      ctx({
        actual: [actualTable({ id: 'public.adminium_users', name: 'adminium_users', system: true })],
      }),
    );
    expect(codes(issues)).toEqual(['SYSTEM_TABLE']);
    expect(issues[0]?.table).toBe('public.adminium_users');
  });

  it('refuses a view — there is no column to add to something Adminium cannot author', () => {
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'note' }, 'public.v_top')] }),
      ctx({ actual: [actualTable({ id: 'public.v_top', name: 'v_top', kind: 'view' })] }),
    );
    expect(codes(issues)).toEqual(['NOT_A_TABLE']);
    expect(issues[0]?.message).toContain('is a view');
  });
});

describe('addColumns — one table, two descriptions', () => {
  /*
   * The rule this door alone can break. `upsertTables` restates a whole table
   * and `addColumns` appends to the snapshot's own model; running both against
   * one table means two desired states for it, and the plan is whichever the
   * planner built last. Refused by name rather than merged.
   */
  it('refuses a table that upsertTables also restates, matched on its id', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [desiredCustomers()], addColumns: [add({ name: 'phone' })] }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['DUPLICATE_TABLE']);
    expect(issues[0]?.message).toBe(
      '"public.customers" is both restated in upsertTables and extended by addColumns',
    );
    // The clash is about the TABLE, so the issue carries no column: the fix is
    // to drop one of the two descriptions, not to rename a field.
    expect(issues[0]?.column).toBeUndefined();
  });

  it('…and matched on its NAME, when the restatement carries no id', () => {
    // A designer that has not saved yet sends `id: null`. The clash is just as
    // real: the planner resolves that table by name onto the same one.
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [desiredCustomers({ id: null })],
        addColumns: [add({ name: 'phone' })],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['DUPLICATE_TABLE']);
  });

  it('stops at the clash instead of also judging the column', () => {
    // An enum column would earn ENUM_ON_NON_ENUM_COLUMN further down the loop.
    // Only the clash is reported, because a column verdict on a table whose
    // desired state is undecided is noise.
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [desiredCustomers()],
        addColumns: [add({ name: 'state', logicalType: 'enum' })],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['DUPLICATE_TABLE']);
  });

  it('leaves an unrelated table alone', () => {
    // The set is per-table, not per-edit: restating `orders` says nothing about
    // extending `customers`.
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [desiredCustomers({ id: null, name: 'orders' })],
        addColumns: [add({ name: 'phone' })],
      }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });
});

describe('addColumns — the identifier it names', () => {
  it('applies the length limit to a column added through this door', () => {
    const name = `a${'b'.repeat(63)}`;
    expect(name).toHaveLength(64);
    const issues = validateSchemaEdit(edit({ addColumns: [add({ name })] }), ctx());
    expect(codes(issues)).toEqual(['IDENTIFIER_TOO_LONG']);
    // The path names both halves, because a column-level document is the only
    // thing the operator can see; "too long" without the table is unactionable.
    expect(issues[0]?.table).toBe('public.customers');
    expect(issues[0]?.column).toBe(name);
  });

  it('applies the reserved-word check too', () => {
    const issues = validateSchemaEdit(edit({ addColumns: [add({ name: 'order' })] }), ctx());
    expect(codes(issues)).toEqual(['RESERVED_IDENTIFIER']);
    expect(issues[0]?.message).toContain('reserved word in postgres');
  });
});

describe('addColumns — the column it adds', () => {
  it('refuses the same column added twice, resolving the table before comparing', () => {
    // Addressed by id in one entry and by bare name in the other. Both resolve
    // to `public.customers`, so this is one column twice, not two columns.
    const issues = validateSchemaEdit(
      edit({
        addColumns: [add({ name: 'phone' }), add({ name: 'phone' }, 'customers')],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['DUPLICATE_COLUMN']);
    expect(issues[0]?.message).toBe('"phone" is added twice');
    expect(issues[0]?.table).toBe('customers');
  });

  it('allows two DIFFERENT columns on the same table in one edit', () => {
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'phone' }), add({ name: 'fax' })] }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });

  it('refuses a column the table already has', () => {
    const issues = validateSchemaEdit(edit({ addColumns: [add({ name: 'email' })] }), ctx());
    expect(codes(issues)).toEqual(['DUPLICATE_COLUMN']);
    expect(issues[0]?.message).toBe('"public.customers" already has a column named "email"');
  });

  it('refuses a display-only type, which this door can only ever be creating', () => {
    // No `typeChanged` subtlety here as there is on the upsert path: everything
    // arriving through `addColumns` is new, so D30 applies flatly.
    for (const logicalType of ['interval', 'binary', 'geometry', 'inet', 'unknown'] as const) {
      const issues = validateSchemaEdit(
        edit({ addColumns: [add({ name: 'blob_col', logicalType })] }),
        ctx(),
      );
      expect(codes(issues), logicalType).toEqual(['UNSUPPORTED_TYPE']);
      expect(issues[0]?.message).toBe(`${logicalType} columns cannot be created`);
    }
  });

  it('refuses an enum column by name, and says which door can express one', () => {
    // Not an oversight: the value list is a CHECK, which is a fact about the
    // table. This form has nowhere to put one, so it refuses rather than
    // emitting a value-less enum.
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'state', logicalType: 'enum' })] }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['ENUM_ON_NON_ENUM_COLUMN']);
    expect(issues[0]?.message).toContain('table designer');
    expect(issues[0]?.column).toBe('state');
  });

  it('refuses a default kind that does not apply to the type', () => {
    const now = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'seen_at', logicalType: 'text', default: { kind: 'now' } })] }),
      ctx(),
    );
    expect(codes(now)).toEqual(['UNSUPPORTED_DEFAULT']);
    expect(now[0]?.message).toBe('a now default does not apply to a text column');

    const auto = validateSchemaEdit(
      edit({
        addColumns: [add({ name: 'code', logicalType: 'varchar', default: { kind: 'autoincrement' } })],
      }),
      ctx(),
    );
    // Two faults, both real: the kind does not apply to the type, AND
    // auto-increment belongs to the key, which this door cannot change (D23).
    expect(codes(auto)).toContain('UNSUPPORTED_DEFAULT');
    expect(codes(auto)).toContain('IDENTITY_NOT_A_KEY');
    // Substring, not equality: the message currently reads "a autoincrement",
    // and a grammar fix to that article must not be a test failure.
    expect(auto.find((i) => i.code === 'UNSUPPORTED_DEFAULT')?.message).toContain(
      'autoincrement default does not apply to a varchar column',
    );
  });

  it('accepts the kinds that do apply, so the rule is a filter and not a ban', () => {
    const issues = validateSchemaEdit(
      edit({
        addColumns: [
          add({ name: 'seen_at', logicalType: 'timestamptz', default: { kind: 'now' } }),
          add({ name: 'token', logicalType: 'uuid', default: { kind: 'uuid' } }),
        ],
      }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });

  /*
   * Auto-increment is NOT one of the kinds that apply here, whatever the type.
   * This door adds a column to a table whose key it cannot change, and a
   * generated integer that is not the key is refused by MySQL outright and
   * silently defaultless on SQLite (D23). It used to be accepted.
   */
  it('refuses auto-increment, because the key is not this door’s to change', () => {
    const issues = validateSchemaEdit(
      edit({
        addColumns: [add({ name: 'rank_no', logicalType: 'integer', default: { kind: 'autoincrement' } })],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['IDENTITY_NOT_A_KEY']);
  });

  it('refuses a literal that is not a literal of the column’s type', () => {
    const issues = validateSchemaEdit(
      edit({
        addColumns: [add({ name: 'qty', logicalType: 'integer', default: { kind: 'literal', text: 'abc' } })],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['INVALID_DEFAULT_LITERAL']);
    expect(issues[0]?.message).toBe('"abc" is not a valid integer literal');
  });

  it('accepts a literal that is one — the kind gate runs first, then the shape', () => {
    const issues = validateSchemaEdit(
      edit({
        addColumns: [
          add({ name: 'qty', logicalType: 'integer', default: { kind: 'literal', text: '42' } }),
          add({ name: 'ok', logicalType: 'boolean', default: { kind: 'literal', text: 'true' } }),
        ],
      }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });

  it('reports every fault on one column rather than the first', () => {
    // A designer that surfaces one problem per round trip is a designer nobody
    // finishes a table in — the function's own contract, asserted on this path.
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'order', logicalType: 'inet', default: { kind: 'now' } })] }),
      ctx(),
    );
    expect(codes(issues)).toEqual([
      'RESERVED_IDENTIFIER',
      'UNSUPPORTED_DEFAULT',
      'UNSUPPORTED_TYPE',
    ]);
    expect(withCode(issues, 'UNSUPPORTED_DEFAULT')).toHaveLength(1);
  });

  it('adds a plain nullable column with nothing to say about it', () => {
    // The control: if any gate above fired on an ordinary add, all of them
    // would be worthless.
    const issues = validateSchemaEdit(
      edit({ addColumns: [add({ name: 'phone', logicalType: 'varchar', maxLength: 32 })] }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });
});
