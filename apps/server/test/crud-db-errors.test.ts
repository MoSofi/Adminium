// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The database's refusals, translated.
 *
 * EVERY FIXTURE BELOW WAS CAPTURED FROM A REAL SERVER on 2026-09-18 —
 * PostgreSQL 18.3, MySQL 26.7.0 and better-sqlite3 — by provoking each
 * refusal on a scratch table and printing the driver's own error object. They
 * are frozen here rather than written from memory because a stubbed error is
 * the classic way a translation layer passes its tests and fails in
 * production (the provider-fakes lesson).
 *
 * The surprises worth naming, all of them found by capturing rather than
 * guessing:
 *
 *   · Postgres names the COLUMN only for 23502. A CHECK gives the constraint,
 *     an enum gives the TYPE, and `value too long` gives neither.
 *   · MySQL spells "not one of this enum's members" as WARN_DATA_TRUNCATED —
 *     the same errno it uses when any other value does not fit its column.
 *   · SQLite sends the EXPRESSION for an unnamed CHECK and the NAME for a
 *     named one, and its type message is `cannot store TEXT value in INTEGER
 *     column t.age`, never "datatype mismatch".
 */
import { describe, expect, it } from 'vitest';

import { readDbRefusal } from '../src/crud/db-errors.js';
import type { ResolvedColumn, ResolvedTable } from '../src/crud/identifiers.js';
import type { EffectiveTable } from '../src/connections/effective-schema.js';

function column(name: string, logicalType: ResolvedColumn['logicalType']): ResolvedColumn {
  return { name, logicalType, nullable: true, isPrimaryKey: false, masked: false, secret: false, textish: false };
}

const COLUMNS = [
  column('id', 'integer'),
  column('name', 'varchar'),
  column('age', 'integer'),
  column('mood', 'enum'),
  column('status', 'varchar'),
  column('status_id', 'integer'),
  column('seen_at', 'timestamptz'),
];

const patients: ResolvedTable = {
  id: 'public.cap_patients',
  schema: 'public',
  name: 'cap_patients',
  primaryKey: ['id'],
  columns: new Map(COLUMNS.map((c) => [c.name, c])),
  readOnly: false,
  table: {
    id: 'public.cap_patients',
    name: 'cap_patients',
    checks: [{ name: 'cap_status_ck', expression: "status IN ('new'::text, 'done'::text)" }],
    columns: [
      { name: 'mood', logicalType: 'enum', enumRef: 'public.cap_mood' },
      { name: 'status', logicalType: 'varchar', enumRef: null },
      { name: 'age', logicalType: 'integer', enumRef: null },
    ],
  } as unknown as EffectiveTable,
};

// --- the fixtures ------------------------------------------------------------

const POSTGRES = {
  notNull: {
    code: '23502',
    column: 'name',
    table: 'cap_patients',
    detail: 'Failing row contains (1, null, 1, null, null, null).',
    message: 'null value in column "name" of relation "cap_patients" violates not-null constraint',
  },
  check: {
    code: '23514',
    constraint: 'cap_status_ck',
    table: 'cap_patients',
    detail: 'Failing row contains (2, a, null, null, nope, null).',
    message: 'new row for relation "cap_patients" violates check constraint "cap_status_ck"',
  },
  enumValue: { code: '22P02', message: 'invalid input value for enum cap_mood: "wibble"' },
  tooLong: { code: '22001', message: 'value too long for type character varying(5)' },
  outOfRange: { code: '22003', message: 'integer out of range' },
  badNumber: { code: '22P02', message: 'invalid input syntax for type integer: "abc"' },
  badDate: { code: '22007', message: 'invalid input syntax for type timestamp with time zone: "not-a-date"' },
};

const MYSQL = {
  notNull: { code: 'ER_BAD_NULL_ERROR', errno: 1048, sqlMessage: "Column 'name' cannot be null" },
  noDefault: { code: 'ER_NO_DEFAULT_FOR_FIELD', errno: 1364, sqlMessage: "Field 'name' doesn't have a default value" },
  check: { code: 'ER_CHECK_CONSTRAINT_VIOLATED', errno: 3819, sqlMessage: "Check constraint 'cap_status_ck' is violated." },
  enumValue: { code: 'WARN_DATA_TRUNCATED', errno: 1265, sqlMessage: "Data truncated for column 'mood' at row 1" },
  truncatedOther: { code: 'WARN_DATA_TRUNCATED', errno: 1265, sqlMessage: "Data truncated for column 'age' at row 1" },
  tooLong: { code: 'ER_DATA_TOO_LONG', errno: 1406, sqlMessage: "Data too long for column 'name' at row 1" },
  outOfRange: { code: 'ER_WARN_DATA_OUT_OF_RANGE', errno: 1264, sqlMessage: "Out of range value for column 'age' at row 1" },
  badNumber: {
    code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
    errno: 1366,
    sqlMessage: "Incorrect integer value: 'abc' for column 'age' at row 1",
  },
  badDate: {
    code: 'ER_TRUNCATED_WRONG_VALUE',
    errno: 1292,
    sqlMessage: "Incorrect datetime value: 'not-a-date' for column 'seen_at' at row 1",
  },
};

const SQLITE = {
  notNull: { code: 'SQLITE_CONSTRAINT_NOTNULL', message: 'NOT NULL constraint failed: cap_patients.name' },
  inlineCheck: { code: 'SQLITE_CONSTRAINT_CHECK', message: "CHECK constraint failed: status in ('new','done')" },
  namedCheck: { code: 'SQLITE_CONSTRAINT_CHECK', message: 'CHECK constraint failed: cap_status_ck' },
  strictType: { code: 'SQLITE_CONSTRAINT_DATATYPE', message: 'cannot store TEXT value in INTEGER column cap_patients.age' },
};

describe('database refusals → field errors', () => {
  it('postgres', () => {
    expect(readDbRefusal(POSTGRES.notNull, patients)).toEqual({ column: 'name', code: 'required' });
    expect(readDbRefusal(POSTGRES.check, patients)).toEqual({ column: 'status', code: 'not-allowed' });
    expect(readDbRefusal(POSTGRES.enumValue, patients)).toEqual({ column: 'mood', code: 'not-allowed' });
    // The type, never the column — so the refusal is form-level rather than a guess.
    expect(readDbRefusal(POSTGRES.tooLong, patients)).toEqual({ column: null, code: 'too-long' });
    expect(readDbRefusal(POSTGRES.outOfRange, patients)).toEqual({ column: null, code: 'out-of-range' });
    expect(readDbRefusal(POSTGRES.badNumber, patients)).toEqual({ column: null, code: 'invalid' });
    expect(readDbRefusal(POSTGRES.badDate, patients)).toEqual({ column: null, code: 'invalid' });
  });

  it('mysql', () => {
    expect(readDbRefusal(MYSQL.notNull, patients)).toEqual({ column: 'name', code: 'required' });
    expect(readDbRefusal(MYSQL.noDefault, patients)).toEqual({ column: 'name', code: 'required' });
    expect(readDbRefusal(MYSQL.check, patients)).toEqual({ column: 'status', code: 'not-allowed' });
    expect(readDbRefusal(MYSQL.enumValue, patients)).toEqual({ column: 'mood', code: 'not-allowed' });
    // The SAME errno on a non-enum column means the value did not fit.
    expect(readDbRefusal(MYSQL.truncatedOther, patients)).toEqual({ column: 'age', code: 'invalid' });
    expect(readDbRefusal(MYSQL.tooLong, patients)).toEqual({ column: 'name', code: 'too-long' });
    expect(readDbRefusal(MYSQL.outOfRange, patients)).toEqual({ column: 'age', code: 'out-of-range' });
    expect(readDbRefusal(MYSQL.badNumber, patients)).toEqual({ column: 'age', code: 'invalid' });
    expect(readDbRefusal(MYSQL.badDate, patients)).toEqual({ column: 'seen_at', code: 'invalid' });
  });

  it('sqlite', () => {
    expect(readDbRefusal(SQLITE.notNull, patients)).toEqual({ column: 'name', code: 'required' });
    expect(readDbRefusal(SQLITE.inlineCheck, patients)).toEqual({ column: 'status', code: 'not-allowed' });
    expect(readDbRefusal(SQLITE.namedCheck, patients)).toEqual({ column: 'status', code: 'not-allowed' });
    expect(readDbRefusal(SQLITE.strictType, patients)).toEqual({ column: 'age', code: 'invalid' });
  });

  it('never names a column the target table does not have', () => {
    const elsewhere = { code: '23502', column: 'nickname', message: 'null value in column "nickname"' };
    expect(readDbRefusal(elsewhere, patients)).toEqual({ column: null, code: 'required' });
  });

  it('prefers the longer of two similar column names', () => {
    const check = {
      code: '23514',
      constraint: 'cap_status_id_ck',
      message: 'violates check constraint "cap_status_id_ck"',
    };
    const table: ResolvedTable = {
      ...patients,
      table: {
        ...patients.table,
        checks: [{ name: 'cap_status_id_ck', expression: 'status_id > 0' }],
      } as unknown as EffectiveTable,
    };
    expect(readDbRefusal(check, table)).toEqual({ column: 'status_id', code: 'not-allowed' });
  });

  it('leaves everything else alone', () => {
    expect(readDbRefusal(new Error('connection terminated unexpectedly'), patients)).toBeNull();
    expect(readDbRefusal({ code: '42601', message: 'syntax error at or near "slect"' }, patients)).toBeNull();
    expect(readDbRefusal({ code: '23505', message: 'duplicate key value' }, patients)).toBeNull();
    expect(readDbRefusal(null, patients)).toBeNull();
  });
});
