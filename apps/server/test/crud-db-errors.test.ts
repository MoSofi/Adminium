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

import { isWriteConflict, readDbRefusal } from '../src/crud/db-errors.js';
import { ConflictError } from '../src/errors.js';
import { mapDbError } from '../src/routes/data/index.js';
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
  nulText: { code: '22021', message: 'invalid byte sequence for encoding "UTF8": 0x00' },
  nulJson: { code: '22P05', message: 'unsupported Unicode escape sequence' },
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
    // U+0000, which the write service refuses before it is sent: the answer if one ever arrives anyway.
    expect(readDbRefusal(POSTGRES.nulText, patients)).toEqual({ column: null, code: 'invalid-character' });
    expect(readDbRefusal(POSTGRES.nulJson, patients)).toEqual({ column: null, code: 'invalid-character' });
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

/**
 * LOCK CONFLICTS, captured the same way on 2026-09-24 — PostgreSQL 18.3,
 * MySQL 26.7.0 and better-sqlite3 — by making two connections want the same
 * rows: crossed `FOR UPDATE`s for the deadlocks, two SERIALIZABLE updates of
 * one row, a `FOR UPDATE` behind another with a 1 s `innodb_lock_wait_timeout`
 * (and a 100 ms `lock_timeout` on Postgres), and on SQLite a second
 * `BEGIN IMMEDIATE`, then a WAL snapshot upgraded after another commit.
 *
 * Worth naming: SQLite says "database is locked" for BOTH of its codes, and
 * MySQL's deadlock carries SQLSTATE 40001 on `sqlState` — the Postgres
 * serialization code — while its lock wait carries HY000.
 */
const LOCKS = {
  postgres: {
    deadlock: {
      code: '40P01',
      severity: 'ERROR',
      routine: 'DeadLockReport',
      detail:
        'Process 5862 waits for ShareLock on transaction 1112711; blocked by process 5864.\n' +
        'Process 5864 waits for ShareLock on transaction 1112710; blocked by process 5862.',
      message: 'deadlock detected',
    },
    serialization: {
      code: '40001',
      severity: 'ERROR',
      routine: 'ExecUpdate',
      message: 'could not serialize access due to concurrent update',
    },
    lockTimeout: {
      code: '55P03',
      severity: 'ERROR',
      routine: 'ProcessInterrupts',
      message: 'canceling statement due to lock timeout',
    },
  },
  mysql: {
    deadlock: {
      code: 'ER_LOCK_DEADLOCK',
      errno: 1213,
      sqlState: '40001',
      sqlMessage: 'Deadlock found when trying to get lock; try restarting transaction',
      message: 'Deadlock found when trying to get lock; try restarting transaction',
    },
    lockWait: {
      code: 'ER_LOCK_WAIT_TIMEOUT',
      errno: 1205,
      sqlState: 'HY000',
      sqlMessage: 'Lock wait timeout exceeded; try restarting transaction',
      message: 'Lock wait timeout exceeded; try restarting transaction',
    },
  },
  sqlite: {
    busy: { code: 'SQLITE_BUSY', message: 'database is locked' },
    busySnapshot: { code: 'SQLITE_BUSY_SNAPSHOT', message: 'database is locked' },
  },
};

const EVERY_LOCK: [string, object][] = Object.entries(LOCKS).flatMap(([engine, errors]) =>
  Object.entries(errors).map(([name, error]): [string, object] => [`${engine} ${name}`, error]),
);

/** A driver error as the driver throws it: an Error carrying the fields. */
function thrown(fields: object): Error {
  const { message, ...rest } = fields as { message: string };
  return Object.assign(new Error(message), rest);
}

/** What `mapDbError` threw, or a failed test when it threw nothing. */
function mapped(error: unknown, table?: ResolvedTable): unknown {
  try {
    mapDbError(error, table);
  } catch (out) {
    return out;
  }
  return expect.unreachable('mapDbError must throw');
}

describe('lock conflicts → 409 WRITE_CONFLICT', () => {
  it.each(EVERY_LOCK)('%s is a write conflict', (_, error) => {
    expect(isWriteConflict(error)).toBe(true);
    expect(isWriteConflict(thrown(error))).toBe(true);
  });

  it.each(EVERY_LOCK)('%s is not a refused value', (_, error) => {
    expect(readDbRefusal(thrown(error), patients)).toBeNull();
  });

  it.each(EVERY_LOCK)('%s maps to a retryable 409 that names nothing of the engine’s', (_, error) => {
    for (const table of [patients, undefined]) {
      const out = mapped(thrown(error), table);
      expect(out).toBeInstanceOf(ConflictError);
      expect(out).toMatchObject({
        statusCode: 409,
        code: 'WRITE_CONFLICT',
        message: 'Someone else changed this at the same moment. Try again.',
        details: { retry: true },
      });
      // Not the engine's prose: a deadlock report names processes and transactions.
      expect(JSON.stringify((out as ConflictError).details)).not.toMatch(/process|transaction|lock/i);
    }
  });

  it('reads a MySQL conflict by its errno when the symbol is missing', () => {
    expect(isWriteConflict({ errno: 1213, message: 'Deadlock found' })).toBe(true);
    expect(isWriteConflict({ errno: 1205, message: 'Lock wait timeout exceeded' })).toBe(true);
  });

  it('leaves every other error alone', () => {
    // The refusals above, the unique and FK codes, and the ones nobody maps.
    for (const error of [...Object.values(POSTGRES), ...Object.values(MYSQL), ...Object.values(SQLITE)]) {
      expect(isWriteConflict(error)).toBe(false);
    }
    expect(isWriteConflict({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isWriteConflict({ code: 'ER_DUP_ENTRY', errno: 1062 })).toBe(false);
    // SQLITE_BUSY's prefix, not a substring of some other code.
    expect(isWriteConflict({ code: 'SQLITE_BUSYNESS', message: 'x' })).toBe(false);
    expect(isWriteConflict({ code: 'SQLITE_LOCKED', message: 'database table is locked' })).toBe(false);
    // A Node system error carries a NEGATIVE errno.
    expect(isWriteConflict(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', errno: -54 }))).toBe(false);
    // Already translated: a conflict is not mapped twice.
    expect(isWriteConflict(new ConflictError('taken', 'CAPACITY_BUSY'))).toBe(false);
    expect(isWriteConflict(null)).toBe(false);
    expect(isWriteConflict('40P01')).toBe(false);
  });

  it('keeps unique and foreign-key conflicts as they were', () => {
    expect(mapped(thrown({ code: '23505', message: 'duplicate key value' }), patients)).toMatchObject({
      statusCode: 409,
      code: 'UNIQUE_VIOLATION',
    });
    expect(mapped(thrown({ code: '23503', message: 'violates foreign key constraint' }), patients)).toMatchObject({
      statusCode: 409,
      code: 'FK_VIOLATION',
    });
  });
});
