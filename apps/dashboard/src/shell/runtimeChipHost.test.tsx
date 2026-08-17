/**
 * The runtime chip AS THE PRODUCT RENDERS IT (11-electron.md §8.1).
 *
 * WHY THIS SUITE EXISTS, given `runtimeChipState.test.ts` already covers the
 * decision: that suite calls the function with its own arguments, so it would
 * stay green if `RuntimeChipHost` fetched nothing, or if the chip were never
 * mounted in the topbar at all. This one renders the REAL `Topbar` against a
 * stubbed `fetch` and asserts on the two things the pure suite structurally
 * cannot see — that the component asks the two feeds §8.1 names, and that the
 * chip is actually in the topbar.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, TooltipProvider } from '@adminium/ui';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShortcutsProvider } from './ShortcutsProvider.js';
import { Topbar } from './Topbar.js';

// Resolves the REAL en-US bundles, so the chip labels asserted below are the
// shipped copy rather than this file's fallbacks — and the §8.1 detail string's
// `{names}` argument actually interpolates.
const restoreI18n = installTestI18n();
afterAll(restoreI18n);

interface StubOptions {
  runtime?: 'self-host' | 'desktop';
  connections?: Array<{ name: string; engine: string; sourceKind: string; status: string }>;
  /** Answer `/connections` with a 403, as it does for every non-admin. */
  connectionsForbidden?: boolean;
}

function stubFetch({ runtime = 'desktop', connections = [], connectionsForbidden = false }: StubOptions = {}) {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/system/info')) {
      return Promise.resolve(
        jsonResponse(200, {
          version: '0.5.0',
          node: 'v22.0.0',
          dialect: 'sqlite',
          runtime,
          smtpConfigured: false,
          networkFeaturesAllowed: true,
        }),
      );
    }
    if (url.startsWith('/api/v1/connections')) {
      return Promise.resolve(
        connectionsForbidden
          ? jsonResponse(403, {
              error: { code: 'FORBIDDEN', message: 'system:connections:manage required', requestId: 'req_f' },
            })
          : jsonResponse(200, { connections }),
      );
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderTopbar() {
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ShortcutsProvider>
            <Topbar
              bootstrap={makeBootstrap()}
              title="Customers"
              onOpenPalette={() => {}}
              onSignOut={() => {}}
              onOpenAccount={() => {}}
              onOpenStudio={() => {}}
              onOpenStudioPages={() => {}}
              onOpenStudioSettings={() => {}}
            />
          </ShortcutsProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the runtime chip in the real Topbar', () => {
  it('renders the Local chip inside the topbar on desktop', async () => {
    stubFetch({ runtime: 'desktop' });
    renderTopbar();

    const chip = await screen.findByText('Local');
    expect(chip.getAttribute('data-part')).toBe('runtime-chip');
    expect(chip.getAttribute('data-state')).toBe('local');
    // The chip is IN the topbar, not merely on the page — the wiring is the claim.
    expect(chip.closest('[data-part="topbar"]')).not.toBeNull();
  });

  it('reads the two §8.1 feeds — /system/info and the connection-health poll', async () => {
    const fetchMock = stubFetch({ runtime: 'desktop' });
    renderTopbar();
    await screen.findByText('Local');

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.startsWith('/api/v1/system/info'))).toBe(true);
    expect(urls.some((url) => url.startsWith('/api/v1/connections'))).toBe(true);
  });

  it('renders no chip on self-host', async () => {
    stubFetch({ runtime: 'self-host' });
    renderTopbar();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeDefined();
    });
    expect(document.querySelector('[data-part="runtime-chip"]')).toBeNull();
  });

  /**
   * The poll is desktop-only work. A browser tab that hit `/connections` every
   * 30 s to compute a badge it never draws would be a real cost paid by every
   * self-host user.
   */
  it('does not poll connections on self-host', async () => {
    const fetchMock = stubFetch({ runtime: 'self-host' });
    renderTopbar();

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith('/api/v1/system/info'))).toBe(true);
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith('/api/v1/connections'))).toBe(false);
  });

  it('escalates to the warn chip and names the unreachable database', async () => {
    stubFetch({
      runtime: 'desktop',
      connections: [{ name: 'prod-db', engine: 'postgres', sourceKind: 'dsn', status: 'error' }],
    });
    renderTopbar();

    const chip = await screen.findByText('Remote DB offline');
    expect(chip.getAttribute('data-state')).toBe('remote-db-offline');
    expect(chip.getAttribute('title')).toContain('prod-db');
  });

  /**
   * REGRESSION — the bug this suite could not see while it stubbed `/connections`
   * as 200 unconditionally. That route needs the Admin-only
   * `system:connections:manage`; the topbar renders for everyone. An earlier cut
   * defaulted the refused answer to `[]` and drew a confident `Local`.
   */
  it('draws no chip at all when the health poll is refused, rather than a false Local', async () => {
    stubFetch({ runtime: 'desktop', connectionsForbidden: true });
    renderTopbar();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeDefined();
    });
    expect(screen.queryByText('Local')).toBeNull();
    expect(document.querySelector('[data-part="runtime-chip"]')).toBeNull();
  });

  it('shows the muted remote chip while the remote database is healthy', async () => {
    stubFetch({
      runtime: 'desktop',
      connections: [{ name: 'prod-db', engine: 'postgres', sourceKind: 'dsn', status: 'connected' }],
    });
    renderTopbar();

    expect((await screen.findByText('Local + remote DB')).getAttribute('data-state')).toBe('remote-db');
  });
});
