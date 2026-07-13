import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNDO_WINDOW_MS, useUndoableAction } from './useUndoableAction.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useUndoableAction', () => {
  it('performs optimistically and auto-commits after the window', async () => {
    const perform = vi.fn(() => ['row-1']);
    const undo = vi.fn();
    const commit = vi.fn();
    const { result } = renderHook(() => useUndoableAction({ perform, undo, commit }));

    expect(result.current.state).toBe('idle');
    await act(async () => {
      await result.current.run();
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('pending');
    expect(commit).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledWith(['row-1']);
    expect(undo).not.toHaveBeenCalled();
    expect(result.current.state).toBe('committed');
  });

  it('undo within the window reverts and blocks the auto-commit', async () => {
    const undo = vi.fn();
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useUndoableAction({ perform: () => 42, undo, commit, timeoutMs: 1000 }),
    );

    await act(async () => {
      const run = await result.current.run();
      await run.undo();
    });
    expect(undo).toHaveBeenCalledWith(42);
    expect(result.current.state).toBe('undone');

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('undo and commit are idempotent — first settle wins', async () => {
    const undo = vi.fn();
    const commit = vi.fn();
    const { result } = renderHook(() => useUndoableAction({ perform: () => 1, undo, commit }));

    await act(async () => {
      await result.current.run();
      await result.current.undo();
      await result.current.undo();
      await result.current.commit();
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('a new run finalizes the previous pending run first', async () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useUndoableAction({ perform: () => 'ctx', undo: () => {}, commit }),
    );
    await act(async () => {
      await result.current.run();
      await result.current.run();
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits a pending run on unmount', async () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useUndoableAction({ perform: () => 'ctx', undo: () => {}, commit }),
    );
    await act(async () => {
      await result.current.run();
    });
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledWith('ctx');
  });

  it('reports transitions via onStateChange', async () => {
    const seen: string[] = [];
    const { result } = renderHook(() =>
      useUndoableAction({
        perform: () => 0,
        undo: () => {},
        onStateChange: (s) => seen.push(s),
      }),
    );
    await act(async () => {
      const run = await result.current.run();
      await run.undo();
    });
    expect(seen).toEqual(['pending', 'undone']);
  });
});
