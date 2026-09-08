// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Test animation (`designs/Automation Rules.dc.html` 451-462;
 * 42-automations-and-workflow-logs.md D14, 42-T23).
 *
 * The comp's cadence exactly: one node lit at a time for 620 ms, a green
 * check accumulating behind it, everything else at .5 opacity, and the whole
 * thing cleared 2.2 s after the last step.
 *
 * --- DEPARTURE D14: it walks the path the run actually took ---------------
 *
 * The comp's `runTest` walks the FIRST branch of every fork (454) because it
 * has no engine behind it. This calls `POST /automations/:id/test` with the
 * ON-SCREEN document, gets a real trace back — conditions evaluated for real,
 * every action resolved, nothing executed — and animates over the nodes that
 * trace names. So a fork whose condition is false lights the OTHER side, and
 * a step that would fail lights red rather than green. That is the difference
 * between a demonstration and a test.
 *
 * The timers are cleared on unmount and on a second Test: a person who clicks
 * twice gets one animation, not two overlapping ones.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Trace } from '../api.js';

/** The comp's own two numbers (451-462). */
export const STEP_MS = 620;
export const CLEAR_MS = 2_200;

export interface TestRunState {
  /** The node lit right now, or null when nothing is running. */
  runningId: string | null;
  /** The nodes that have finished — they carry the green check. */
  ranIds: string[];
  testing: boolean;
}

export interface UseTestRun extends TestRunState {
  /** Hand it a trace; it plays. */
  play: (trace: Trace) => void;
  cancel: () => void;
}

export function useTestRun(): UseTestRun {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [ranIds, setRanIds] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancel = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    setRunningId(null);
    setRanIds([]);
  }, []);

  useEffect(() => cancel, [cancel]);

  const play = useCallback(
    (trace: Trace) => {
      cancel();
      // The trace's own order, which is the order the rule would run — not
      // the graph's, and not "the first branch of every fork".
      const sequence = trace.steps.filter((step) => step.status !== 'skip').map((step) => step.nodeId);
      if (sequence.length === 0) return;
      setRanIds([]);
      setRunningId(sequence[0] ?? null);
      sequence.forEach((_, index) => {
        timers.current.push(
          setTimeout(
            () => {
              setRunningId(sequence[index + 1] ?? null);
              setRanIds(sequence.slice(0, index + 1));
            },
            (index + 1) * STEP_MS,
          ),
        );
      });
      timers.current.push(
        setTimeout(
          () => {
            setRanIds([]);
          },
          sequence.length * STEP_MS + CLEAR_MS,
        ),
      );
    },
    [cancel],
  );

  return { runningId, ranIds, testing: runningId !== null, play, cancel };
}
