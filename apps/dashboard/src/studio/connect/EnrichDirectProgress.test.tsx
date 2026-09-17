// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Direct-API enrichment progress.
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
function scriptFetch(detail: unknown = { id: 'run_1', status: 'validated', validationErrors: null }): {
  calls: Call[];
} {
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
      return Promise.resolve(jsonResponse(200, detail));
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

/*
 * A direct run that never reached a response fails at the PROVIDER, and that
 * error is a different shape from a validation failure — no `severity`, no
 * `path`. The screen used to look only for a `severity: 'fatal'` entry, found
 * nothing, and fell back to "Check your AI settings and retry", which is true
 * but says nothing. The provider's own sentence names the setting.
 */
describe('EnrichDirectProgress — a failed run says why', () => {
  it('shows the provider error rather than the generic fallback', async () => {
    scriptFetch({
      id: 'run_1',
      status: 'failed',
      validationErrors: [
        {
          kind: 'provider',
          provider: 'anthropic',
          code: 'http',
          message: 'anthropic: HTTP 400 — `temperature` is deprecated for this model.',
        },
      ],
    });

    render(
      <EnrichDirectProgress
        runId="run_1"
        provider="anthropic"
        model="claude-sonnet-5"
        onContinueReview={() => undefined}
        onCancel={() => undefined}
        pollIntervalMs={0}
      />,
    );

    // Twice over: the log console's last line and the Alert beneath it.
    await waitFor(() => {
      expect(screen.getAllByText(/deprecated for this model/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Check your AI settings and retry/)).toBeNull();
  });

  it('still shows a fatal validation error when the model did answer', async () => {
    scriptFetch({
      id: 'run_1',
      status: 'failed',
      validationErrors: [
        { code: 'LLM_JSON_PARSE', severity: 'fatal', path: '', message: 'Unexpected token at position 1.' },
      ],
    });

    render(
      <EnrichDirectProgress
        runId="run_1"
        provider="anthropic"
        model="claude-sonnet-5"
        onContinueReview={() => undefined}
        onCancel={() => undefined}
        pollIntervalMs={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Unexpected token at position 1.').length).toBeGreaterThan(0);
    });
  });
});
