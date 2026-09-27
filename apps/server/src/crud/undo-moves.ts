// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A move marked `undo`: the listed move that takes back the one the other
 * way (an order back to preparing after a Ready tapped by mistake).
 *
 * It is a move like any other — its roles, what it waits for — with three
 * differences, each read from here by the step that applies it:
 *
 *  - it is made only by a write that names the state it saw the row in, so a
 *    stale screen's tap never takes back another screen's move (the judge,
 *    `crud/states.ts`);
 *  - the stamps written when the row entered the state it returns to keep
 *    what they had (the time it started preparing is still the first one),
 *    and the stamps marked `clearOnBack` that watch the state it leaves are
 *    emptied (DECIDE, `crud/decide.ts`);
 *  - what it waits for is judged on the row as it stands, before anything is
 *    emptied — a move allowed a minute after `ready_at` reads `ready_at`.
 *
 * Pure: no I/O.
 */
import type { ColumnStampRule, StampTrigger, TableStatesRule } from '../connections/effective-schema.js';
import type { Row } from './mask.js';

export interface UndoMove {
  from: string;
  to: string;
}

const stateOf = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** The move a write makes when it is one marked `undo`, from the stored state to the one it names; else null. */
export function undoMoveOf(states: TableStatesRule | undefined, stored: Row | null, values: Row): UndoMove | null {
  if (states === undefined || stored === null || !Object.prototype.hasOwnProperty.call(values, states.column)) return null;
  const from = stateOf(stored[states.column]) ?? states.initial;
  const to = stateOf(values[states.column]);
  if (to === null || to === from) return null;
  const move = (states.moves[from] ?? []).find((candidate) => (typeof candidate === 'string' ? candidate : candidate.to) === to);
  return typeof move === 'object' && move.undo === true ? { from, to } : null;
}

/** The states a stamp is written on entering, through the state column. */
function statesWatched(stamp: Pick<ColumnStampRule, 'on'>, column: string): string[] {
  const triggers: StampTrigger[] = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
  return triggers.flatMap((trigger) => (typeof trigger === 'object' && 'values' in trigger && trigger.column === column ? trigger.values.map(String) : []));
}

/** Whether an undo leaves this stamp as it is: it is written on entering the state the undo returns to. */
export function keptByUndo(stamp: Pick<ColumnStampRule, 'on'>, column: string, move: UndoMove): boolean {
  return statesWatched(stamp, column).includes(move.to);
}

/** Whether an undo empties this stamp: marked `clearOnBack`, and written on entering the state the undo leaves. */
export function emptiedByUndo(stamp: Pick<ColumnStampRule, 'on' | 'clearOnBack'>, column: string, move: UndoMove): boolean {
  return stamp.clearOnBack === true && !keptByUndo(stamp, column, move) && statesWatched(stamp, column).includes(move.from);
}

/** The columns an undo empties, of a table's columns and their stamps. */
export function columnsEmptiedByUndo(columns: readonly { name: string; stamp?: ColumnStampRule | undefined }[], stateColumn: string, move: UndoMove): string[] {
  return columns.flatMap((column) => (column.stamp !== undefined && emptiedByUndo(column.stamp, stateColumn, move) ? [column.name] : []));
}

/** An undo of a change that was one status move: taken back by the move marked `undo` the other way. */
export interface MoveBack {
  column: string;
  /** The state the change left the row in; the undo names it as the state it saw. */
  from: string;
  /** The state the undo takes the row back to. */
  to: string;
}

/**
 * The move that takes back one change of one row, when the change was a
 * status move and nothing else a person wrote (the stamps the move wrote
 * aside), and the table lists a move marked `undo` the other way; else
 * null — the change is not one an undo can take back by a move.
 */
export function moveBackOf(
  table: { states?: TableStatesRule | undefined; columns: readonly { name: string; stamp?: ColumnStampRule | undefined }[] } | undefined,
  before: readonly Row[],
  after: readonly Row[],
  changedColumns: readonly string[],
): MoveBack | null {
  const states = table?.states;
  if (states === undefined || before.length !== 1 || after.length !== 1) return null;
  const was = stateOf(before[0]![states.column]) ?? states.initial;
  const now = stateOf(after[0]![states.column]) ?? states.initial;
  if (was === now) return null;
  const stamped = new Set(table!.columns.flatMap((column) => (column.stamp === undefined ? [] : [column.name])));
  if (changedColumns.some((column) => column !== states.column && !stamped.has(column))) return null;
  const back = undoMoveOf(states, { [states.column]: now }, { [states.column]: was });
  return back === null ? null : { column: states.column, from: now, to: was };
}
