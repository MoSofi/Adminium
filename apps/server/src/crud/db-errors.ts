// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DATABASE'S REFUSALS, TRANSLATED.
 *
 * Adminium does not pre-judge a write (see `crud/column-rules.ts`): a NOT NULL
 * column may be filled by a trigger nobody here can see, so the database
 * decides and this module reads its answer.
 *
 * Until now it read only two of them. `mapDbError` knew unique (23505) and
 * foreign key (23503) and rethrew everything else, so a NOT NULL, CHECK, enum,
 * length or type refusal reached the browser as **HTTP 500 `INTERNAL`** — in
 * production with the message stripped and no column named. The person who had
 * just filled in a form was told "Something went wrong. Share the request id
 * with support."
 *
 * What comes out of here is a `{ column, code }` pair, and the route turns it
 * into 422 `VALIDATION_FAILED` with `details.fields = { <column>: { code } }`,
 * which the dashboard renders **under the field**. The wording is chosen on
 * the CLIENT from the code: the server's English never reaches
 * a translated screen.
 *
 * ── THE RULES OF THIS FILE ─────────────────────────────────────────────────
 *
 * 1. A column parsed out of a driver message is accepted ONLY if the target
 *    table really has it. A message is not a promise.
 * 2. With no column to name, the refusal is still translated — form-level,
 *    422 with a code and no `fields`. A 422 that says "check your values" is
 *    a better answer than a 500 that says nothing.
 * 3. Unique and foreign-key mapping is UNCHANGED. Those two already had
 *    friendly shapes and callers that depend on them.
 * 4. The public surface collapses all of this into its one opaque refusal
 *    (`routes/public/index.ts` `refuseWrite`): naming a column to an anonymous
 *    caller is a membership oracle.
 * 5. A LOCK CONFLICT is not a refused value. Two writers wanted the same rows
 *    at the same moment and the database gave one of them up (a deadlock, a
 *    serialization failure, a lock wait that ran out, a busy SQLite file).
 *    Nothing the person typed was wrong and the same write a moment later
 *    goes through, so it is 409 `WRITE_CONFLICT` with `{ retry: true }`
 *    ({@link isWriteConflict}), never a 422 and never a 500.
 */

import { ConflictError } from '../errors.js';
import type { ResolvedTable } from './identifiers.js';
import type { IssueCode } from './column-rules.js';

/** What the database refused, and — when it said so — where. */
export interface DbRefusal {
  column: string | null;
  code: IssueCode;
}

/** The shape all three drivers' errors are read through. */
interface DriverError {
  code?: unknown;
  errno?: unknown;
  column?: unknown;
  constraint?: unknown;
  table?: unknown;
  detail?: unknown;
  sqlMessage?: unknown;
  message?: unknown;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Rule 1: a name from a message counts only if the table has that column. */
function columnIn(table: ResolvedTable, name: string | null | undefined): string | null {
  if (typeof name !== 'string' || name === '') return null;
  return table.columns.has(name) ? name : null;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A CHECK constraint names no column, so the snapshot answers instead: find
 * the constraint by name, then the first column of the table its expression
 * mentions. `CHECK (status IN ('a','b'))` → `status`.
 *
 * Longest name first, so a table carrying both `status` and `status_id` does
 * not credit the shorter one for the longer one's expression.
 */
function columnForCheck(table: ResolvedTable, constraint: string | null): string | null {
  if (constraint === null || constraint === '') return null;
  // SQLite sends the EXPRESSION itself for an unnamed constraint
  // (`CHECK constraint failed: status in ('new','done')`) and the NAME for a
  // named one, so the captured text is tried as both.
  const check = table.table?.checks?.find((row) => row.name === constraint);
  const expression = check?.expression ?? constraint;
  const names = [...table.columns.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`(^|[^\\w"\`])"?\`?${escapeForRegExp(name)}\`?"?($|[^\\w"\`])`);
    if (pattern.test(expression)) return name;
  }
  return null;
}

/**
 * Postgres names the enum TYPE, not the column: `invalid input value for enum
 * mood: "x"`. One column of that type ⇒ that column; two ⇒ nothing, because a
 * guess under the wrong field is worse than a form-level message.
 */
function columnForEnumType(table: ResolvedTable, typeName: string): string | null {
  const columns = (table.table?.columns ?? []).filter((column) => {
    const ref = column.enumRef;
    return ref !== null && (ref === typeName || ref.endsWith(`.${typeName}`));
  });
  return columns.length === 1 ? (columns[0]?.name ?? null) : null;
}

/** `Column 'email' cannot be null` / `for column 'email' at row 1`. */
function quotedColumn(message: string): string | null {
  const match = /(?:column|field)\s+'([^']+)'/i.exec(message);
  return match?.[1] ?? null;
}

// --- per engine ---------------------------------------------------------------

/**
 * SQLSTATE classes, from the messages Postgres actually sends. `23502`
 * carries `error.column`; the rest carry only prose, so the column is
 * recovered from the snapshot where it can be at all.
 */
function postgresRefusal(error: DriverError, table: ResolvedTable, message: string): DbRefusal | null {
  switch (textOf(error.code)) {
    case '23502':
      return { column: columnIn(table, textOf(error.column)), code: 'required' };
    case '23514':
      return { column: columnForCheck(table, textOf(error.constraint)), code: 'not-allowed' };
    case '22P02': {
      // `invalid input value for enum <type>: "x"` — a refused enum member.
      // Anything else under 22P02 is a value that does not parse as its type.
      const enumType = /invalid input value for enum ([^\s:]+)/i.exec(message)?.[1];
      if (enumType !== undefined) {
        return { column: columnForEnumType(table, enumType.replace(/^.*\./, '')), code: 'not-allowed' };
      }
      return { column: null, code: 'invalid' };
    }
    case '22001':
      // `value too long for type character varying(5)` — the type, never the
      // column. Form-level, deliberately: rule 1.
      return { column: null, code: 'too-long' };
    case '22003':
      return { column: null, code: 'out-of-range' };
    case '22007':
    case '22008':
      return { column: null, code: 'invalid' };
    default:
      return null;
  }
}

/** mysql2 puts a SCREAMING_SNAKE symbol on `code` and the prose on `sqlMessage`. */
function mysqlRefusal(error: DriverError, table: ResolvedTable, message: string): DbRefusal | null {
  const column = (): string | null => columnIn(table, quotedColumn(message));
  switch (textOf(error.code)) {
    case 'ER_BAD_NULL_ERROR':
    case 'ER_NO_DEFAULT_FOR_FIELD':
      return { column: column(), code: 'required' };
    case 'ER_CHECK_CONSTRAINT_VIOLATED': {
      // `Check constraint 'orders_chk_1' is violated.`
      const constraint = /check constraint '([^']+)'/i.exec(message)?.[1] ?? null;
      return { column: columnForCheck(table, constraint), code: 'not-allowed' };
    }
    case 'WARN_DATA_TRUNCATED': {
      // `Data truncated for column 'status' at row 1`. On an `enum()` column
      // that is MySQL's spelling of "not one of the members"; on any other
      // column the same errno means the value did not fit its type, and
      // "choose one of the listed values" would be nonsense there.
      const name = column();
      const isEnum = (table.table?.columns ?? []).some(
        (candidate) => candidate.name === name && candidate.logicalType === 'enum',
      );
      return { column: name, code: isEnum ? 'not-allowed' : 'invalid' };
    }
    case 'ER_DATA_TOO_LONG':
      return { column: column(), code: 'too-long' };
    case 'ER_WARN_DATA_OUT_OF_RANGE':
      return { column: column(), code: 'out-of-range' };
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD':
    case 'ER_TRUNCATED_WRONG_VALUE':
      return { column: column(), code: 'invalid' };
    default:
      return null;
  }
}

/**
 * better-sqlite3 carries an extended result code and a message that names the
 * table and column outright — the friendliest of the three. SQLite has no
 * length limit and no numeric range, so `too-long` and `out-of-range` simply
 * do not occur there.
 */
function sqliteRefusal(table: ResolvedTable, message: string): DbRefusal | null {
  const notNull = /NOT NULL constraint failed: [^.\s]+\.([^\s,]+)/i.exec(message)?.[1];
  if (notNull !== undefined) return { column: columnIn(table, notNull), code: 'required' };
  if (/CHECK constraint failed/i.test(message)) {
    const named = /CHECK constraint failed:\s*(.+)$/i.exec(message)?.[1]?.trim() ?? null;
    return { column: columnForCheck(table, named), code: 'not-allowed' };
  }
  // A STRICT table names the column: `cannot store TEXT value in INTEGER
  // column t.age`. An ordinary table almost never gets here at all — SQLite's
  // dynamic typing stores `'abc'` in an `integer` column without complaint,
  // which is why `column-rules.ts` does not pre-judge shapes on this engine.
  const stored = /cannot store \w+ value in \w+ column [^.\s]+\.([^\s,]+)/i.exec(message)?.[1];
  if (stored !== undefined) return { column: columnIn(table, stored), code: 'invalid' };
  if (/datatype mismatch/i.test(message)) return { column: null, code: 'invalid' };
  return null;
}

/**
 * Read a driver error as a refused value, or `null` when it is something else
 * entirely (a dropped connection, a syntax error, a permission).
 *
 * All three engines are tried on every error rather than switched on a dialect
 * argument: the signals do not collide — a SQLSTATE is five characters, a
 * mysql2 code is a SCREAMING_SNAKE word, and SQLite's are whole English
 * sentences — and `mapDbError` is reached from callers that do not all carry a
 * dialect.
 */
export function readDbRefusal(error: unknown, table: ResolvedTable): DbRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  const driver = error as DriverError;
  const message = textOf(driver.sqlMessage) || textOf(driver.message);
  return (
    postgresRefusal(driver, table, message) ??
    mysqlRefusal(driver, table, message) ??
    sqliteRefusal(table, message)
  );
}

// --- lock conflicts (rule 5) -----------------------------------------------------

/**
 * The codes each engine gives the writer it gives up, as the drivers really
 * send them (fixtures captured in `test/crud-db-errors.test.ts`):
 *
 *   · Postgres: `40001` serialization_failure, `40P01` deadlock_detected, and
 *     `55P03` lock_not_available — what a `lock_timeout` a DBA set on the role
 *     raises when a `FOR UPDATE` waited too long.
 *   · MySQL: `ER_LOCK_DEADLOCK` (1213) and `ER_LOCK_WAIT_TIMEOUT` (1205). The
 *     errno is read too: the symbol is mysql2's, the number is the server's.
 *   · SQLite: `SQLITE_BUSY` and its extended codes (`SQLITE_BUSY_SNAPSHOT`,
 *     `…_RECOVERY`, `…_TIMEOUT`). The message is only "database is locked",
 *     so the code is the signal.
 */
const POSTGRES_CONFLICTS = new Set(['40001', '40P01', '55P03']);
const MYSQL_CONFLICTS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const MYSQL_CONFLICT_ERRNOS = new Set([1213, 1205]);

/** Whether a driver error is a lost lock race rather than a refused value (rule 5). */
export function isWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const driver = error as DriverError;
  const code = textOf(driver.code);
  return (
    POSTGRES_CONFLICTS.has(code) ||
    MYSQL_CONFLICTS.has(code) ||
    (typeof driver.errno === 'number' && MYSQL_CONFLICT_ERRNOS.has(driver.errno)) ||
    /^SQLITE_BUSY(?:_|$)/.test(code)
  );
}

/**
 * The one answer to a lock conflict. The wording is the person's, not the
 * engine's: "deadlock" and "serialization" mean nothing on a form, and the
 * engine's prose would name the tables and processes involved.
 */
export function writeConflict(): ConflictError {
  return new ConflictError('Someone else changed this at the same moment. Try again.', 'WRITE_CONFLICT', {
    retry: true,
  });
}
