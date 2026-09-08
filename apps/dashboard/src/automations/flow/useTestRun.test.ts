// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Test animation's cadence (42-automations-and-workflow-logs.md D14,
 * 42-T23) — the comp's own two numbers, pinned with fake timers.
 *
 * The assertion that matters is the LAST one: the animation walks the trace's
 * own order and SKIPS the branch the run did not take. The comp lights the
 * first branch of every fork because it has no engine; this product has one,
 * and a test that lit the wrong side would be a demonstration rather than a
 * test.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Trace } from '../api.js';
import { CLEAR_MS, STEP_MS, useTestRun } from './useTestRun.js';

function step(nodeId: string, status: Trace['steps'][number]['status']): Trace['steps'][number] {
  return { nodeId, name: nodeId, kind: 'action', status, startedAt: 0, durationMs: 1, log: null };
}

const TRACE: Trace = {
  version: 1,
  steps: [
    step('n1', 'ok'),
    step('n2', 'ok'),
    // The branch's OTHER side — the run did not take it.
    step('n5', 'skip'),
    step('n3', 'ok'),
  ],
  resume: null,
};

describe('useTestRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lights one node every 620 ms and clears 2.2 s after the last', () => {
    const { result } = renderHook(() => useTestRun());

    act(() => {
      result.current.play(TRACE);
    });
    expect(result.current.runningId).toBe('n1');
    expect(result.current.testing).toBe(true);
    expect(result.current.ranIds).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    expect(result.current.runningId).toBe('n2');
    expect(result.current.ranIds).toEqual(['n1']);

    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    // n5 was skipped by the run, so the walk goes straight to n3.
    expect(result.current.runningId).toBe('n3');
    expect(result.current.ranIds).toEqual(['n1', 'n2']);

    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    expect(result.current.runningId).toBeNull();
    expect(result.current.testing).toBe(false);
    expect(result.current.ranIds).toEqual(['n1', 'n2', 'n3']);

    act(() => {
      vi.advanceTimersByTime(CLEAR_MS);
    });
    expect(result.current.ranIds).toEqual([]);
  });

  it('a second play replaces the first rather than overlapping it', () => {
    const { result } = renderHook(() => useTestRun());
    act(() => {
      result.current.play(TRACE);
      vi.advanceTimersByTime(STEP_MS);
      result.current.play({ version: 1, steps: [step('x1', 'ok')], resume: null });
    });
    expect(result.current.runningId).toBe('x1');
    expect(result.current.ranIds).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    expect(result.current.ranIds).toEqual(['x1']);
  });

  it('an empty trace plays nothing', () => {
    const { result } = renderHook(() => useTestRun());
    act(() => {
      result.current.play({ version: 1, steps: [], resume: null });
    });
    expect(result.current.testing).toBe(false);
  });
});
