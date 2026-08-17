// SPDX-License-Identifier: AGPL-3.0-only
/**
 * White-label chrome: what an operator sets in Workspace settings has to be
 * what every screen shows.
 *
 * The three facts worth a test are the three that were hardcoded before:
 * the rail's wordmark, the mark itself, and the version chip beside them. The
 * fourth — that the PUBLIC branding route is what feeds all of it — is what
 * makes the sign-in screen and the error heroes rebrand too, so it is asserted
 * on a surface that has no session at all.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BrandingData } from '../app/branding.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { BrandMark } from './BrandMark.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const BUILT_IN: BrandingData = { appName: 'Adminium', logoUrl: null, showVersion: true };

function stubFetch(branding: BrandingData, authed = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/branding')) {
        return Promise.resolve(jsonResponse(200, { data: branding }));
      }
      if (authed && url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, { data: makeBootstrap({ version: '9.9.9', nav: { groups: [] } }) }),
        );
      }
      if (url.startsWith('/api/v1/me/notifications')) {
        return Promise.resolve(
          jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }),
        );
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }),
      );
    }),
  );
}

/** The real shell, so the rail under test is the one the app renders. */
async function renderSidebar(branding: BrandingData) {
  stubFetch(branding, true);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    // A studio path avoids the `/` → first-nav-item redirect (navSections does
    // the same); the rail renders identically either way.
    history: createMemoryHistory({ initialEntries: ['/studio/connect'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'Primary' });
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

describe('BrandMark', () => {
  it('renders the built-in mark and name before branding resolves', () => {
    stubFetch(BUILT_IN);
    const queryClient = createQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BrandMark />
      </QueryClientProvider>,
    );
    // Not a spinner and not a gap: chrome that flickers between two identities
    // on every cold load is worse than chrome that starts neutral.
    expect(screen.getByText('Adminium')).toBeDefined();
    expect(document.querySelector('[data-part="brand-logo"]')).toBeNull();
  });

  it('renders the uploaded logo in place of the built-in mark', async () => {
    stubFetch({ appName: 'Fondu', logoUrl: '/api/v1/branding/logo?v=file_1', showVersion: true });
    const queryClient = createQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BrandMark />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Fondu')).toBeDefined();
    const logo = document.querySelector('[data-part="brand-logo"]');
    expect(logo?.getAttribute('src')).toBe('/api/v1/branding/logo?v=file_1');
  });

  it('survives rendering with no QueryClient — the error heroes mount above one', () => {
    // `useQuery` throws without a client, so this is what keeps "the API is
    // down" from rendering as a blank page instead of a state screen.
    expect(() => render(<BrandMark />)).not.toThrow();
    expect(screen.getByText('Adminium')).toBeDefined();
  });
});

describe('SidebarNav branding', () => {
  it('shows the workspace name, not the product name', async () => {
    await renderSidebar({ appName: 'Fondu', logoUrl: null, showVersion: true });
    expect(await screen.findByText('Fondu')).toBeDefined();
    expect(screen.queryByText('Adminium')).toBeNull();
  });

  it('renders the version chip by default', async () => {
    await renderSidebar(BUILT_IN);
    expect(await screen.findByText('v9.9.9')).toBeDefined();
  });

  it('hides the version chip when the workspace turned it off', async () => {
    await renderSidebar({ ...BUILT_IN, showVersion: false });
    // The chip is bootstrap-driven and the flag is branding-driven, so wait
    // for the branding query to land before asserting the absence.
    await screen.findByText('Adminium');
    expect(screen.queryByText('v9.9.9')).toBeNull();
    expect(document.querySelector('[data-part="sidebar-version"]')).toBeNull();
  });
});
