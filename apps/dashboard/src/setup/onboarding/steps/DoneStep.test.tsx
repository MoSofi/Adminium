// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The last step's consent answers read the operator's locks from
 * `GET /settings/telemetry` (plan 75 §5.1): in trial mode both are drawn off
 * and read-only with "Set by the operator"; elsewhere both answer as before.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse } from '../../../test/fixtures.js';
import { DoneStep } from './DoneStep.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(reply: unknown): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, reply))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DoneStep connection={null} storage="local" start="blank" invitedCount={0} consent={{ telemetry: false, updateCheck: false }} onConsentChange={() => undefined} />
    </QueryClientProvider>,
  );
}

const LOCK = { allowed: false, reason: 'trial-mode' };
const OPEN = { allowed: true, reason: null };

describe('DoneStep consent', () => {
  it('in trial mode: both read-only, set by the operator', async () => {
    mount({ data: { telemetry: false, updateCheck: false, locks: { telemetry: LOCK, updateCheck: LOCK } } });
    await waitFor(() => expect(screen.getAllByText('Set by the operator')).toHaveLength(2));
    expect(screen.getByRole('switch', { name: 'Share anonymous usage data' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('elsewhere, or on an older server: both answer', async () => {
    mount({ data: { telemetry: false, updateCheck: false, locks: { telemetry: OPEN, updateCheck: OPEN } } });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText('Set by the operator')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Check for new releases' }).getAttribute('aria-disabled')).toBeNull();
  });
});
