// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Undo/redo over the unsaved document (the comp's
 * `pushHist`/`undo`/`redo`, 1341-1352): a stack of SNAPSHOTS, sixty deep, of
 * whatever the editor holds — name, status, topic, language and the body
 * together, so one undo step reverts one edit whatever it touched.
 *
 * Snapshots are serialized strings, as in the comp: cheap to compare (a push
 * that repeats the top of the stack is dropped — 1342 — so focusing a field
 * twice without typing costs nothing) and immune to a later in-place mutation
 * of the object that was snapshotted. The email surface's `model/history.ts`
 * is the same machine; kept separate so neither tree imports the other.
 *
 * Pure: every function returns a new history; the hook that owns the draft
 * decides when to push (the comp pushes on focus — `beginEdit`, 1343 — and
 * before every structural change).
 */

export const HISTORY_LIMIT = 60;

export interface History {
  past: readonly string[];
  future: readonly string[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

export function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

/** Records `current` as the state to return to; clears redo. */
export function pushHistory(history: History, current: unknown, limit = HISTORY_LIMIT): History {
  const snap = snapshot(current);
  if (history.past[history.past.length - 1] === snap) return history;
  return { past: [...history.past, snap].slice(-limit), future: [] };
}

/** `[next history, the state to restore]`, or `null` when there is nothing to undo. */
export function undoHistory<T>(history: History, current: T): [History, T] | null {
  const snap = history.past[history.past.length - 1];
  if (snap === undefined) return null;
  return [{ past: history.past.slice(0, -1), future: [...history.future, snapshot(current)] }, JSON.parse(snap) as T];
}

/** `[next history, the state to restore]`, or `null` when there is nothing to redo. */
export function redoHistory<T>(history: History, current: T): [History, T] | null {
  const snap = history.future[history.future.length - 1];
  if (snap === undefined) return null;
  return [{ past: [...history.past, snapshot(current)], future: history.future.slice(0, -1) }, JSON.parse(snap) as T];
}
