import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Duration of the undo window, matching the undo-toast auto-dismiss
 * (03-component-library.md §7.2 — action/Undo 5200ms).
 */
export const UNDO_WINDOW_MS = 5200;

export type UndoableState = 'idle' | 'pending' | 'committed' | 'undone';

export interface UseUndoableActionOptions<T> {
  /**
   * Apply the mutation optimistically. The return value is the undo context
   * (e.g. the deleted rows) handed back to `undo`/`commit`.
   */
  perform: () => T | Promise<T>;
  /** Revert the optimistic mutation. */
  undo: (context: T) => void | Promise<void>;
  /**
   * Finalize the mutation once the undo window elapses without an undo
   * (e.g. hard-delete server-side). Optional — omit when `perform` already
   * persisted the change.
   */
  commit?: ((context: T) => void | Promise<void>) | undefined;
  /** Undo window in ms before auto-commit. Default `UNDO_WINDOW_MS` (5200). */
  timeoutMs?: number | undefined;
  /** Observe state transitions (e.g. to dismiss the paired undo toast). */
  onStateChange?: ((state: UndoableState) => void) | undefined;
}

export interface UndoableRun<T> {
  /** The context returned by `perform`. */
  context: T;
  /** Revert now (idempotent — the first of undo/commit wins). */
  undo: () => Promise<void>;
  /** Finalize now instead of waiting for the window (idempotent). */
  commit: () => Promise<void>;
}

export interface UseUndoableActionReturn<T> {
  /** Perform the action optimistically and open the undo window. */
  run: () => Promise<UndoableRun<T>>;
  /** Undo the latest pending run (no-op when nothing is pending). */
  undo: () => Promise<void>;
  /** Commit the latest pending run early (no-op when nothing is pending). */
  commit: () => Promise<void>;
  /** Lifecycle of the latest run. */
  state: UndoableState;
}

/**
 * useUndoableAction — the perform-with-undo primitive behind destructive
 * mutations (03-component-library.md §7.2 Undo pattern): `run()`
 * applies the mutation optimistically, then either `undo()` reverts it within
 * the window or `commit()` finalizes it (called automatically when the window
 * elapses, and on unmount while pending).
 *
 * Pairs with `useToastQueue`:
 * ```tsx
 * const queue = useToastQueue();
 * const deletion = useUndoableAction({ perform, undo });
 * const onDelete = async () => {
 *   const run = await deletion.run();
 *   queue.push({ title: '12 records deleted', action: { label: 'Undo', onAction: run.undo } });
 * };
 * ```
 */
export function useUndoableAction<T>(options: UseUndoableActionOptions<T>): UseUndoableActionReturn<T> {
  const [state, setState] = useState<UndoableState>('idle');
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const pendingRef = useRef<UndoableRun<T> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const transition = useCallback((next: UndoableState) => {
    setState(next);
    optionsRef.current.onStateChange?.(next);
  }, []);

  const run = useCallback(async (): Promise<UndoableRun<T>> => {
    // A new run supersedes a still-pending one: finalize the old first.
    if (pendingRef.current !== null) await pendingRef.current.commit();

    const context = await optionsRef.current.perform();
    let settled = false;

    const settle = async (kind: 'undone' | 'committed'): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimer();
      if (pendingRef.current === handle) pendingRef.current = null;
      if (kind === 'undone') await optionsRef.current.undo(context);
      else await optionsRef.current.commit?.(context);
      transition(kind);
    };

    const handle: UndoableRun<T> = {
      context,
      undo: () => settle('undone'),
      commit: () => settle('committed'),
    };

    pendingRef.current = handle;
    transition('pending');
    timerRef.current = setTimeout(() => {
      void handle.commit();
    }, optionsRef.current.timeoutMs ?? UNDO_WINDOW_MS);
    return handle;
  }, [transition]);

  const undo = useCallback(async () => {
    await pendingRef.current?.undo();
  }, []);

  const commit = useCallback(async () => {
    await pendingRef.current?.commit();
  }, []);

  // Finalize a pending run on unmount — the optimistic mutation already
  // happened, so dropping the commit would leave it half-applied.
  useEffect(
    () => () => {
      clearTimer();
      void pendingRef.current?.commit();
    },
    [],
  );

  return { run, undo, commit, state };
}
