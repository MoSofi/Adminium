// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN, AND BY WHOM, A COLUMN MAY CHANGE (`column.changes`).
 *
 * A quote's approval becomes approved or refused only from asked, and never
 * by the person who asked nor by the deal's owner; an enquiry's deal is set
 * only while the enquiry is claimed, by its claimer. Each guard holds a change
 * of its column — to one of `to`, or any change — and every guard that holds
 * a change is met, or the write is refused:
 *
 *  - `from`: the stored row holds one of the values (a new row holds none);
 *  - `while`: another column holds one of some values (or is empty, or not),
 *    in the stored row and in the row as the write leaves it;
 *  - `by`: the writer is the person a staff column names — of the row, or of
 *    the row one of its links names — in the stored row (a new row: as made);
 *  - `notBy`: the writer is none of the people these name, in the stored row
 *    nor as the write leaves it: naming somebody else in the same write
 *    changes nothing.
 *
 * It is the data's own rule, judged here, in the write path, so every door
 * holds it: a change on a page, a record's button (saved as a change), a bulk
 * edit, a file somebody brings in, the public API, a rule. History is not
 * judged: an undo puts back what was, and an app's sample and seed rows say
 * what happened then. `by` and `notBy` judge a person — a signed-in staff
 * member; an API key or a visitor is a person nobody names — and a write
 * Adminium makes by itself (a rule's step, a move when a moment passes) has
 * nobody to judge: it is held to `from` and `while` alone.
 *
 * A person the snapshot can no longer read (a column or a link it lost)
 * fails closed: a `by` holds for nobody, a `notBy` for everybody.
 *
 * The refusal is 403 `COLUMN_FORBIDDEN`, naming the column and why
 * (`reason`: `change-from`, `change-while`, `change-by`, `change-not-by`).
 * What an update was judged on in the stored row goes with it to the
 * statement (`attachExpect`): a row changed meanwhile is not written.
 */
import { sql } from 'kysely';

import { ForbiddenError } from '../errors.js';
import type { ChangeGuardRule, GuardPerson, TableRules } from './column-rules.js';
import type { Row } from './mask.js';
import { couldBeKey } from './soft-links.js';
import { holds } from './state-conditions.js';
import type { WriteAction, WriteContext, WriteTarget } from './write-context.js';
import { sameValue } from './write-values.js';

/** What the guards made of one write: the refusal, or what the statement must still find in the stored row. */
export interface ChangeGuardVerdict {
  refusal: ForbiddenError | null;
  /** For an update: the stored values the guards read, held as conditions of its statement. */
  expect: Row | null;
}

const NONE: ChangeGuardVerdict = { refusal: null, expect: null };

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';
const has = (values: Row, column: string): boolean => Object.prototype.hasOwnProperty.call(values, column);

/** A person nobody can tell: the column or the link is gone. */
const UNREADABLE = Symbol('unreadable');

/** Values as a refusal says them: `"approved" or "refused"`. */
const said = (values: readonly unknown[]): string => values.map((value) => JSON.stringify(value)).join(' or ');

/** Whether any guard of the table could hold this write at all: nothing to read otherwise. */
export function changeGuardsJudge(rules: TableRules | null, action: WriteAction, context: Pick<WriteContext, 'origin' | 'stamps'>): boolean {
  if ((rules?.changes?.length ?? 0) === 0 || action === 'delete' || context.origin === 'undo') return false;
  // An app's sample and seed rows are history; a file a person brings in is their own create or change.
  return !(context.origin === 'import' && context.stamps !== 'left-out');
}

/**
 * Judge the write's values against the table's guards. `stored` is the row
 * as it is (null for a new row); an update whose stored row is gone is not
 * judged here (the caller answers it).
 */
export async function judgeChangeGuards(rules: TableRules | null, action: WriteAction, target: Pick<WriteTarget, 'db' | 'table'>, context: WriteContext, values: Row, stored: Row | null): Promise<ChangeGuardVerdict> {
  if (!changeGuardsJudge(rules, action, context)) return NONE;
  if (action === 'update' && stored === null) return NONE;
  const actor = context.actor;
  // The person a write is: a staff member by id; a key or a visitor is somebody no column names. Adminium itself is nobody to judge.
  const person = actor !== null && (actor.kind === 'user' || actor.kind === 'api-key' || actor.kind === 'public') ? { id: actor.kind === 'user' ? actor.id : null } : null;
  const after: Row = { ...(stored ?? {}), ...values };
  const expect: Row = {};
  const table = target.table.id;
  const refuse = (rule: ChangeGuardRule, reason: string, message: string, details: Record<string, unknown>): ChangeGuardVerdict => ({
    refusal: new ForbiddenError(message, 'COLUMN_FORBIDDEN', { table, column: rule.column, reason, ...details }),
    expect: null,
  });
  /** Who a person path names in a row: their id, nobody (null), or a row the snapshot can no longer read. */
  const named = async (path: GuardPerson, row: Row): Promise<string | null | typeof UNREADABLE> => {
    if (path.unresolved === true) return UNREADABLE;
    const value = row[path.column];
    if (empty(value)) return null;
    if (path.far === undefined) return String(value);
    if (!couldBeKey(path.far.keyType, value)) return null;
    const found = (await target.db
      .selectFrom(path.far.table)
      .select(sql.ref(path.far.column).as('person') as never)
      .where((eb) => eb(target.db.dynamic.ref(path.far!.key), '=', value))
      .limit(1)
      .executeTakeFirst()) as { person?: unknown } | undefined;
    return empty(found?.person) ? null : String(found!.person);
  };
  /** Held as a condition of the update's statement: what the stored row held in a column the guard read. */
  const held = (column: string): void => {
    if (action === 'update' && stored !== null) expect[column] = stored[column] ?? null;
  };

  for (const rule of rules!.changes!) {
    if (!has(values, rule.column)) continue;
    const next = values[rule.column];
    // A new row's value is a change from nothing; a value sent back as the row holds it is no change.
    if (action === 'create' ? empty(next) : sameValue(next, stored![rule.column])) continue;
    for (const guard of rule.guards) {
      if (guard.to !== undefined && !guard.to.some((value) => sameValue(value, next))) continue;
      const to = guard.to === undefined ? 'change' : `change to ${said(guard.to)}`;
      if (guard.from !== undefined) {
        if (action === 'create' || !holds({ column: rule.column, in: [...guard.from] }, stored!)) {
          return refuse(rule, 'change-from', `${rule.column} may ${to} only from ${said(guard.from)}.`, { from: guard.from });
        }
        held(rule.column);
      }
      if (guard.while !== undefined) {
        const condition = 'in' in guard.while ? { column: guard.while.column, in: [...guard.while.in] } : { column: guard.while.column, isNull: guard.while.isNull };
        const rows = action === 'create' ? [after] : [stored!, after];
        if (!rows.every((row) => holds(condition, row))) {
          const state = 'in' in guard.while ? `${guard.while.column} is ${said(guard.while.in)}` : `${guard.while.column} is ${guard.while.isNull ? 'empty' : 'filled'}`;
          return refuse(rule, 'change-while', `${rule.column} may ${to} only while ${state}.`, { while: guard.while });
        }
        held(guard.while.column);
      }
      if (person === null) continue;
      if (guard.by !== undefined) {
        const who = await named(guard.by, action === 'create' ? after : stored!);
        if (who === UNREADABLE || who === null || person.id === null || who !== person.id) {
          return refuse(rule, 'change-by', `${rule.column} may ${to} only by the person ${guard.by.path} names.`, { by: guard.by.path });
        }
        if (guard.by.unresolved !== true) held(guard.by.column);
      }
      for (const path of guard.notBy ?? []) {
        for (const row of action === 'create' ? [after] : [stored!, after]) {
          const who = await named(path, row);
          if (who === UNREADABLE || (who !== null && person.id !== null && who === person.id)) {
            return refuse(rule, 'change-not-by', `${rule.column} may not ${to} by the person ${path.path} names.`, { notBy: path.path });
          }
        }
        if (path.unresolved !== true) held(path.column);
      }
    }
  }
  return { refusal: null, expect: action === 'update' && Object.keys(expect).length > 0 ? expect : null };
}
