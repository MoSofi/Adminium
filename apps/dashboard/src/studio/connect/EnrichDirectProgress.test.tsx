// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Direct-API enrichment progress (06-llm-assist.md §10.2 step 3).
 *
 * Regression for the StrictMode double-invoke hang: main.tsx wraps the app in
 * <React.StrictMode>, which runs each effect setup→cleanup→setup on the same
 * fiber. The mount effect must re-arm `cancelledRef` on every setup, or the
 * single `run()` resolves into a poll loop the simulated cleanup already
 * cancelled and the screen sticks on "Building prompt…". Rendering under
 * StrictMode here pins that the poll loop still reaches completion.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { EnrichDirectProgress } from './EnrichDirectProgress.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  method: string;
  url: string;
}

/** Script the direct-path routes: execute → job (succeeded) → run detail. */
function scriptFetch(): { calls: Call[] } {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    const path = url.split('?')[0] ?? '';

    if (method === 'POST' && path.endsWith('/execute')) {
      return Promise.resolve(jsonResponse(202, { jobId: 'job_1' }));
    }
    if (method === 'GET' && path.includes('/jobs/')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: {
            id: 'job_1',
            kind: 'llm-run',
            status: 'succeeded',
            progress: { pct: 100, message: 'Validating' },
            lastError: null,
          },
        }),
      );
    }
    if (method === 'GET' && /\/llm\/runs\/run_1$/.test(path)) {
      return Promise.resolve(jsonResponse(200, { id: 'run_1', status: 'validated', validationErrors: null }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

describe('EnrichDirectProgress — StrictMode double-invoke', () => {
  it('polls to completion instead of hanging on "Building prompt…"', async () => {
    const harness = scriptFetch();
    const onContinueReview = vi.fn();

    render(
      <StrictMode>
        <EnrichDirectProgress
          runId="run_1"
          provider="anthropic"
          model="claude-x"
          onContinueReview={onContinueReview}
          onCancel={() => undefined}
          pollIntervalMs={0}
        />
      </StrictMode>,
    );

    // The job was executed exactly once (startedRef guards the double setup)…
    await waitFor(() => {
      expect(harness.calls.some((c) => c.method === 'POST' && c.url.endsWith('/execute'))).toBe(true);
    });
    expect(harness.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/execute'))).toHaveLength(1);

    // …and the poll loop ran to completion (not stuck) — the done state renders.
    await waitFor(() => {
      expect(screen.getByText('Enrichment complete — review the suggestions.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Continue to review' })).toBeTruthy();
  });
});
