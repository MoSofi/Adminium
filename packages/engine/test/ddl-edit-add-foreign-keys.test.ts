// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addForeignKeys` — a link for a column that is already there, to another
 * table's key: between a column and a table the database has, never from a
 * column it lacks or to a table or a key that is not there.
 */
import { describe, expect, it } from 'vitest';

import { isReservedWord, validateSchemaEdit, type EditValidationContext, type SchemaEdit } from '../src/index.js';

const jobs = { id: 'public.jobs', schema: 'public', name: 'jobs', kind: 'table' as const, system: false, columns: [{ name: 'id', isPrimaryKey: true, logicalType: 'integer', maxLength: null } as never], primaryKey: ['id'] };
const lines = {
  id: 'public.lines',
  schema: 'public',
  name: 'lines',
  kind: 'table' as const,
  system: false,
  columns: [{ name: 'id', isPrimaryKey: true, logicalType: 'integer', maxLength: null } as never, { name: 'job_id', isPrimaryKey: false, logicalType: 'integer', maxLength: null } as never],
  primaryKey: ['id'],
};
const ctx: EditValidationContext = { dialect: 'postgres', maxIdentifierLength: 63, actual: [jobs, lines], metaSharesDatabase: false, isReserved: isReservedWord };
const edit = (addForeignKeys: NonNullable<SchemaEdit['addForeignKeys']>): SchemaEdit => ({ baseSnapshotId: 'snap_1', renames: { tables: [], columns: [] }, upsertTables: [], addColumns: [], alterColumns: [], dropTables: [], addForeignKeys });
const codes = (e: SchemaEdit) => validateSchemaEdit(e, ctx).map((i) => i.code);
const LINK = { table: 'public.lines', column: 'job_id', toTable: 'public.jobs', toColumns: ['id'] };

describe('addForeignKeys', () => {
  it('links a column the table has to a key that is there, by id or by bare name', () => {
    expect(codes(edit([LINK]))).toEqual([]);
    expect(codes(edit([{ ...LINK, table: 'lines', toTable: 'jobs' }]))).toEqual([]);
  });

  it('refuses a column the table lacks', () => {
    expect(validateSchemaEdit(edit([{ ...LINK, column: 'task_id' }]), ctx)).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN', table: 'public.lines', column: 'task_id' })]);
  });

  it('refuses a table that is not there, and a key its target lacks', () => {
    expect(codes(edit([{ ...LINK, toTable: 'public.tasks' }]))).toEqual(['UNKNOWN_TABLE']);
    expect(codes(edit([{ ...LINK, toColumns: ['code'] }]))).toEqual(['UNKNOWN_COLUMN']);
  });
});
