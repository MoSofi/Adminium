// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GenerateStep` cancellation (09 §8.2 step 4 tail).
 *
 * The step narrates a click-started async chain — a staged delay, the generate
 * POST, another delay — so it can outlive the tree that started it. It now
 * carries the `cancelledRef` its two siblings (`TestStep`,
 * `EnrichDirectProgress`) already had, and this file pins the half of that
 * pattern which is easy to get wrong: the ref is RE-ARMED on every effect
 * setup, not merely initialised once.
 *
 * Without the re-arm, React.StrictMode's setup→cleanup→setup double-invoke —
 * which `main.tsx` really does run — leaves the ref stuck `true` from the
 * simulated cleanup, and the step then silently narrates nothing and never
 * reaches its success state. That is why this test renders inside StrictMode:
 * a plain render passes either way, and would prove nothing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures.js';
import { GenerateStep } from './GenerateStep.js';
import type { WizardState } from '../wizardState.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const GENERATED = {
  pages: 3,
  navGroups: ['workspace', 'library'],
  snapshotId: 'snap_1',
  introspected: false,
  intent: 'read-only-analytics',
  result: { created: 3, updated: 0, unchanged: 0, pruned: 0, preserved: [] },
  warnings: [],
  durationMs: 12,
};

function renderStep(onOpenApp = vi.fn()) {
  const state = {
    mode: 'dsn',
    connectionId: 'conn_1',
    intent: 'read-only-analytics',
  } as unknown as WizardState;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        {/* No staged delay: the point here is the cancellation ref, not the
            narration's pacing, and a real 250ms×2 would only add flake. */}
        <GenerateStep state={state} onOpenApp={onOpenApp} lineDelayMs={0} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { onOpenApp };
}

describe('GenerateStep under StrictMode', () => {
  it('still generates after the double-invoked effect, and narrates it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, GENERATED)),
    );
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Generate dashboard' }));

    // Reached the success state: the ref was re-armed, so nothing on the chain
    // was skipped as cancelled.
    expect(await screen.findByText('Your dashboard is ready')).toBeDefined();
    expect(screen.getByText(/3 pages across 2 navigation groups/)).toBeDefined();
  });

  it('surfaces a failed generate rather than sitting on the spinner', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(500, { error: { code: 'INTERNAL', message: 'generation exploded' } }),
      ),
    );
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Generate dashboard' }));

    // The error path runs through the same ref; a cancelled-looking ref would
    // swallow this too.
    expect(await screen.findByRole('alert')).toBeDefined();
  });
});
