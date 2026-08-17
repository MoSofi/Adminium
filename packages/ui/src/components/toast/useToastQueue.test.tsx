// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOAST_DEFAULT_DURATIONS } from './Toast.js';
import { MAX_VISIBLE_TOASTS, TOAST_ACTION_DURATION, useToastQueue } from './useToastQueue.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useToastQueue', () => {
  it('pushes newest-first and auto-dismisses with per-variant durations', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.push({ variant: 'success', title: 'Saved' });
      result.current.push({ variant: 'error', title: 'Failed' });
    });
    expect(result.current.toasts.map((t) => t.title)).toEqual(['Failed', 'Saved']);
    expect(result.current.toasts[1]?.duration).toBe(TOAST_DEFAULT_DURATIONS.success);

    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_DURATIONS.success as number);
    });
    expect(result.current.toasts.map((t) => t.title)).toEqual(['Failed']);

    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_DURATIONS.error as number);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('clamps to 4 visible; overflow queues FIFO and enters as slots free up', () => {
    const { result } = renderHook(() => useToastQueue());
    const ids: string[] = [];
    act(() => {
      for (let i = 1; i <= 6; i++) {
        ids.push(result.current.push({ title: `t${i}`, duration: null }));
      }
    });
    expect(result.current.toasts).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(result.current.toasts.map((t) => t.title)).toEqual(['t4', 't3', 't2', 't1']);

    act(() => {
      result.current.dismiss(ids[0]);
    });
    // t5 (queued first) promotes as the newest visible row.
    expect(result.current.toasts.map((t) => t.title)).toEqual(['t5', 't4', 't3', 't2']);
  });

  it('actioned toasts default to 5200ms and dismiss after the action fires', () => {
    const { result } = renderHook(() => useToastQueue());
    const onAction = vi.fn();
    act(() => {
      result.current.push({ title: 'Deleted', action: { label: 'Undo', onAction } });
    });
    expect(result.current.toasts[0]?.duration).toBe(TOAST_ACTION_DURATION);

    act(() => {
      result.current.toasts[0]?.action?.onAction();
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(result.current.toasts).toHaveLength(0);
  });

  it('pause-on-hover freezes timers; resume continues with remaining time', () => {
    const { result } = renderHook(() => useToastQueue());
    act(() => {
      result.current.push({ variant: 'success', title: 'Saved' }); // 2600ms
    });
    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.stackProps.onMouseEnter();
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.stackProps.onMouseLeave();
      vi.advanceTimersByTime(599);
    });
    expect(result.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('update patches in place and restarts the timer (loading → done)', () => {
    const { result } = renderHook(() => useToastQueue());
    let id = '';
    act(() => {
      id = result.current.push({ variant: 'loading', title: 'Exporting…' });
    });
    expect(result.current.toasts[0]?.duration).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.toasts).toHaveLength(1); // loading never auto-dismisses

    act(() => {
      result.current.update(id, { variant: 'success', title: 'Exported' });
    });
    expect(result.current.toasts[0]?.title).toBe('Exported');
    expect(result.current.toasts[0]?.duration).toBe(TOAST_DEFAULT_DURATIONS.success);
    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_DURATIONS.success as number);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('promise() drives loading → success and loading → error', async () => {
    const { result } = renderHook(() => useToastQueue());

    let resolve!: (v: string) => void;
    const ok = new Promise<string>((r) => {
      resolve = r;
    });
    act(() => {
      void result.current.promise(ok, {
        loading: 'Saving…',
        success: (v) => `Saved ${v}`,
        error: 'Save failed',
      });
    });
    expect(result.current.toasts[0]?.variant).toBe('loading');

    await act(async () => {
      resolve('report');
      await Promise.resolve();
    });
    expect(result.current.toasts[0]?.variant).toBe('success');
    expect(result.current.toasts[0]?.title).toBe('Saved report');

    let reject!: (e: unknown) => void;
    const bad = new Promise<string>((_r, rj) => {
      reject = rj;
    });
    act(() => {
      result.current.promise(bad, { loading: 'Saving…', success: 'ok', error: 'Save failed' }).catch(() => {});
    });
    await act(async () => {
      reject(new Error('nope'));
      await Promise.resolve();
    });
    expect(result.current.toasts[0]?.variant).toBe('error');
    expect(result.current.toasts[0]?.title).toBe('Save failed');
  });

  it('dismiss() with no id clears visible toasts and the pending queue', () => {
    const { result } = renderHook(() => useToastQueue());
    act(() => {
      for (let i = 0; i < 6; i++) result.current.push({ title: `t${i}`, duration: null });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.toasts).toHaveLength(0);
    act(() => {
      result.current.push({ title: 'fresh', duration: null });
    });
    // Queue was cleared — nothing extra promotes alongside the new toast.
    expect(result.current.toasts).toHaveLength(1);
  });
});
