// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addUniques` — a rule that no two rows hold the same values in several
 * columns together, added to an existing table by its own name: over columns
 * the table has or the same edit adds, never over one it lacks, never wider
 * than MySQL can index, and under a name the engine can hold.
 */
import { describe, expect, it } from 'vitest';

import { isReservedWord, validateSchemaEdit, withUniques, type EditValidationContext, type SchemaEdit, type TableModel } from '../src/index.js';

const table = {
  id: 'public.waitlist',
  schema: 'public',
  name: 'waitlist',
  kind: 'table' as const,
  system: false,
  columns: [
    { name: 'id', isPrimaryKey: true, logicalType: 'integer', maxLength: null } as never,
    { name: 'event_id', isPrimaryKey: false, logicalType: 'integer', maxLength: null } as never,
    { name: 'email', isPrimaryKey: false, logicalType: 'varchar', maxLength: 200 } as never,
    { name: 'note', isPrimaryKey: false, logicalType: 'varchar', maxLength: 700 } as never,
  ],
  primaryKey: ['id'],
};
const ctx = (over: Partial<EditValidationContext> = {}): EditValidationContext => ({
  dialect: 'postgres',
  maxIdentifierLength: 63,
  actual: [table],
  metaSharesDatabase: false,
  isReserved: isReservedWord,
  ...over,
});
const edit = (over: Partial<SchemaEdit> = {}): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  addColumns: [],
  alterColumns: [],
  dropTables: [],
  ...over,
});
const codes = (e: SchemaEdit, c = ctx()) => validateSchemaEdit(e, c).map((i) => i.code);

describe('addUniques', () => {
  it('takes columns the table has, or the same edit adds', () => {
    expect(codes(edit({ addUniques: [{ table: 'public.waitlist', columns: ['event_id', 'email'], name: 'uq_waitlist_event_id_email' }] }))).toEqual([]);
    const seat = { table: 'public.waitlist', column: { name: 'seat', logicalType: 'varchar', nullable: true, default: null, maxLength: 8, numericPrecision: null, numericScale: null, comment: null } };
    expect(codes(edit({ addColumns: [seat as never], addUniques: [{ table: 'public.waitlist', columns: ['event_id', 'seat'], name: 'uq_w_seat' }] }))).toEqual([]);
  });

  it('refuses a column the table lacks, a column named twice, a set MySQL cannot index, and a name too long', () => {
    expect(codes(edit({ addUniques: [{ table: 'public.waitlist', columns: ['event_id', 'gone'], name: 'uq_x' }] }))).toEqual(['UNKNOWN_COLUMN']);
    expect(codes(edit({ addUniques: [{ table: 'public.waitlist', columns: ['email', 'email'], name: 'uq_x' }] }))).toEqual(['DUPLICATE_COLUMN']);
    const wide = edit({ addUniques: [{ table: 'public.waitlist', columns: ['email', 'note'], name: 'uq_x' }] });
    expect(codes(wide, ctx({ dialect: 'mysql' }))).toEqual(['UNSUPPORTED_TYPE']);
    expect(codes(wide)).toEqual([]);
    expect(codes(edit({ addUniques: [{ table: 'public.waitlist', columns: ['event_id', 'email'], name: `uq_${'x'.repeat(70)}` }] }))).toEqual(['IDENTIFIER_TOO_LONG']);
    expect(codes(edit({ addUniques: [{ table: 'public.gone', columns: ['a', 'b'], name: 'uq_x' }] }))).toEqual(['UNKNOWN_TABLE']);
  });

  it('is kept as a constraint, or on SQLite a unique index made in place', () => {
    const model = { ...table, uniques: [], indexes: [], checks: [] } as unknown as TableModel;
    const rule = [{ name: 'uq_w', columns: ['event_id', 'email'] }];
    expect(withUniques(model, rule, 'constraint').uniques).toEqual(rule);
    expect(withUniques(model, rule, 'index').indexes).toEqual([{ name: 'uq_w', columns: ['event_id', 'email'], expression: null, unique: true, primary: false, method: null, partial: false }]);
  });
});
