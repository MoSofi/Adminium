// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE MADE AGAIN WHEN THE ROW CHANGES HANDS (`column.code.renew`).
 *
 * A ticket's code is the door's proof that whoever holds it may walk in. When
 * the ticket goes to somebody else, the old code must stop working at once,
 * and the new holder must be given one the old holder never saw. So a code
 * column may say what renews it: another column of the row that changed (the
 * person the ticket now belongs to), or a column moved to one of a few values
 * (a status). When that happens, the write that makes the change also writes
 * a fresh code — decided in DECIDE, against the row as stored, so it is in the
 * same UPDATE: the old code stops at the commit, and there is no moment when
 * both work.
 *
 * What never renews: a create (it makes a code anyway), an import or a write
 * marked as history (which puts back what was), a writer whose own value for
 * the code is taken (the server's "make a new link", one new code rather than
 * two), and a change that re-sends the value the row already holds. An undo
 * of a change of hands renews once more (`renewForUndo`): the holder comes
 * back, and neither the old code nor the one handed on works after it.
 *
 * The columns renewed are carried on the values under a symbol (as copies
 * are), so the statement can make the code again when the new one collides
 * with a code already stored, and a reply can leave it out: the person who
 * sent a ticket away is never handed the friend's code.
 */
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { TablePrivileges } from '@adminium/engine/adapter';

import type { CodeRenewTrigger } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { refuseUngrantedColumns } from '../connections/privileges.js';
import type { ColumnCode } from './column-rules.js';
import { generateCode, isUniqueViolation } from './decided-columns.js';
import type { Row } from './mask.js';
import type { WriteAction, WriteOrigin } from './write-context.js';
import { sameValue } from './write-values.js';

const RENEWED = Symbol('adminium.renewed');

/** The rules of the codes a change renewed: what a collision needs to make each again. */
type Renewing = Row & { [RENEWED]?: readonly ColumnCode[] };

/** Writes that put back what already happened: a code is never made over them. */
const HISTORY: ReadonlySet<WriteOrigin> = new Set(['import', 'undo']);

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/** Every trigger of a renew rule: one, or a list of up to three. */
export function renewTriggers(code: Pick<ColumnCode, 'renew'>): readonly CodeRenewTrigger[] {
  const on = code.renew?.on;
  return on === undefined ? [] : Array.isArray(on) ? on : [on];
}

/** Whether this change is the one a trigger watches for, against the row as stored. */
function fires(trigger: CodeRenewTrigger, values: Row, before: Row): boolean {
  if (!has(values, trigger.column)) return false;
  const now = values[trigger.column];
  if (sameValue(before[trigger.column], now)) return false;
  return 'changed' in trigger || trigger.values.some((value) => sameValue(value, now));
}

/**
 * The values with a fresh code in each code column whose renew rule this
 * change sets off — the same object when none does. Throws the privilege
 * refusal, naming the column, when the connection's role may not write it: a
 * renew skipped in silence would leave a handed-on ticket's old code working.
 */
export function renewCodes(
  codes: readonly ColumnCode[] | undefined,
  action: WriteAction,
  values: Row,
  before: Row | null,
  context: { origin: WriteOrigin; table: { id: string }; rights?: TablePrivileges | null | undefined },
): Row {
  if (action !== 'update' || before === null || HISTORY.has(context.origin)) return values;
  return renewing(codes, values, before, context);
}

/**
 * An undo that takes a change of hands back: the holder is put back, and the
 * code is made AGAIN — neither the old one (dead since the change) nor the
 * one the other person was given, which must stop working now that the row
 * is no longer theirs. The values an undo writes, with those codes.
 */
export function renewForUndo(
  codes: readonly ColumnCode[] | undefined,
  values: Row,
  current: Row,
  context: { table: { id: string }; rights?: TablePrivileges | null | undefined },
): Row {
  return renewing(codes, values, current, context);
}

function renewing(
  codes: readonly ColumnCode[] | undefined,
  values: Row,
  before: Row,
  context: { table: { id: string }; rights?: TablePrivileges | null | undefined },
): Row {
  const renewed: ColumnCode[] = [];
  for (const code of codes ?? []) {
    if (code.renew === undefined) continue;
    // A writer whose value is taken (the server's own "make a new link") has said what the code is.
    if (has(values, code.column)) continue;
    if (renewTriggers(code).some((trigger) => fires(trigger, values, before))) renewed.push(code);
  }
  if (renewed.length === 0) return values;
  refuseUngrantedColumns(context.rights, context.table, 'update', renewed.map((code) => code.column));
  return remade({ ...values, [RENEWED]: [...((values as Renewing)[RENEWED] ?? []), ...renewed] } as Renewing, renewed);
}

/** The code columns this write renewed, as DECIDE marked them on its values. */
export function renewedColumns(values: Row): string[] {
  return ((values as Renewing)[RENEWED] ?? []).map((code) => code.column);
}

/**
 * The code columns a change renewed, for a reply to leave out: those DECIDE
 * marked, and any renewing code column whose value the change moved (a hook
 * that rebuilt the values drops the mark; the stored rows still tell).
 */
export function renewedBy(outcome: { values: Row; before: Row | null; after: Row | null }, codes: readonly { name: string; code?: { renew?: unknown } | undefined }[]): Set<string> {
  const out = new Set(renewedColumns(outcome.values));
  if (outcome.before !== null && outcome.after !== null) {
    for (const column of codes) {
      if (column.code?.renew !== undefined && !sameValue(outcome.before[column.name], outcome.after[column.name])) out.add(column.name);
    }
  }
  return out;
}

/** How many times a change whose renewed code collided is tried again. */
const RENEW_RETRIES = 4;

/**
 * Run a change's statement, making each renewed code again when it collides
 * with a code already stored — under a savepoint on Postgres inside a
 * transaction, where a refused statement would abort the whole transaction.
 * Returns the statement's result and the values it wrote with. A change that
 * renewed nothing runs the statement once, as it always has.
 */
export async function withRenewRetry<V extends Row, T>(db: Kysely<SourceDatabase>, dialect: Dialect, values: V, run: (values: V) => Promise<T>): Promise<{ result: T; values: V }> {
  const renewed = (values as Renewing)[RENEWED] ?? [];
  if (renewed.length === 0) return { result: await run(values), values };
  let current = values;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { result: await underSavepoint(db, dialect, () => run(current)), values: current };
    } catch (error) {
      if (attempt >= RENEW_RETRIES || !isUniqueViolation(error)) throw error;
      current = remade(current, renewed);
    }
  }
}

/** The same values (the mark kept), each renewed code made afresh. */
function remade<V extends Row>(values: V, renewed: readonly ColumnCode[]): V {
  const out = { ...values } as Row;
  for (const code of renewed) out[code.column] = generateCode(code.prefix, code.length);
  return out as V;
}

async function underSavepoint<T>(db: Kysely<SourceDatabase>, dialect: Dialect, run: () => Promise<T>): Promise<T> {
  if (dialect !== 'postgres' || !db.isTransaction) return run();
  await sql`savepoint adminium_renew`.execute(db);
  try {
    const out = await run();
    await sql`release savepoint adminium_renew`.execute(db);
    return out;
  } catch (error) {
    await sql`rollback to savepoint adminium_renew`.execute(db);
    throw error;
  }
}
