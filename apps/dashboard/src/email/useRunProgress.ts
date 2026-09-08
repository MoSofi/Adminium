// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign run's live progress (39 D12): while the latest run is scheduled
 * or running, subscribe to its job's realtime channel (`jobs:<jobId>`).
 * `progress` events carry the worker's `{ pct, step, message }`; anything
 * else on the channel (`completed`, `failed`, `cancelled`) means the run row
 * changed, and goes through the app's one invalidation map
 * (`api/realtime.ts`, which knows the `email-templates` key — 39 §8). A browser without a socket keeps
 * the refetch-on-focus path — nothing here is load-bearing for correctness.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { invalidateForRealtimeEvent } from '../api/realtime.js';
import { createRealtimeClient } from '../app/ws.js';
import type { EmailRunView } from './api.js';
import { invalidateEmailDocuments } from './queries.js';

export interface RunProgress {
  /** 0–100, the worker's clamp. */
  pct: number;
  /** The worker's message — the campaign run reports `N sent · M failed`. */
  message: string | null;
}

/** `null` unless the run is running; a running run starts at 0 % until the first event. */
export function useRunProgress(run: EmailRunView | undefined): RunProgress | null {
  const queryClient = useQueryClient();
  const status = run !== undefined && (run.status === 'scheduled' || run.status === 'running') ? run.status : null;
  const jobId = status === null ? null : run?.jobId ?? null;
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    setProgress(null);
    if (jobId === null) return;
    let flipped = false;
    const client = createRealtimeClient({
      channels: [`jobs:${jobId}`],
      onEvent: (event) => {
        if (event.type === 'progress') {
          const data = (typeof event.data === 'object' && event.data !== null ? event.data : {}) as { pct?: unknown; message?: unknown };
          setProgress({ pct: typeof data.pct === 'number' ? data.pct : 0, message: typeof data.message === 'string' ? data.message : null });
          // A scheduled run that reports progress has started: pick up the row's new status, once.
          if (statusRef.current === 'scheduled' && !flipped) {
            flipped = true;
            void invalidateEmailDocuments(queryClient);
          }
          return;
        }
        invalidateForRealtimeEvent(queryClient, event);
      },
    });
    client.start();
    return () => {
      client.stop();
    };
  }, [jobId, queryClient]);

  if (status !== 'running') return null;
  return progress ?? { pct: 0, message: null };
}
