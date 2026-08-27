// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `PasswordCard` is mounted on TWO routes on purpose — `/account`, beside name
 * and email, and `/account/security`, beside two-factor and sessions.
 *
 * This is the file that says so. The component was extracted from
 * `SecurityPage` so both pages could share one implementation, and a shared
 * component is exactly the kind that loses a mount point quietly: deleting one
 * `<PasswordCard />` line breaks no types, fails no other test, and leaves a
 * page that merely looks a little shorter. So both mounts are asserted, and
 * asserted through the real router rather than by rendering the component
 * directly — rendering it directly would still pass with both pages gutted.
 *
 * It also pins the success copy's ONE constraint: it must not tell the reader
 * where the session list is. On `/account/security` the list sits directly
 * below (the original wording said so); on `/account` there is no list on the
 * page at all, and the same sentence renders there.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
      }
      if (url.startsWith('/api/v1/auth/sessions')) {
        return Promise.resolve(jsonResponse(200, { data: { sessions: [] } }));
      }
      if (url.startsWith('/api/v1/me/notifications')) {
        return Promise.resolve(
          jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }),
        );
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
      );
    }),
  );
}

async function renderRoute(path: string) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return screen.findByTestId('password-current');
}

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

describe('the shared password form', () => {
  it.each([
    ['/account', 'beside name and email'],
    ['/account/security', 'beside two-factor and sessions'],
  ])('is mounted on %s (%s)', async (path) => {
    await renderRoute(path);
    expect(screen.getByTestId('password-new')).toBeDefined();
    expect(screen.getByTestId('password-confirm')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDefined();
  });

  it('never tells the reader the session list is "below"', async () => {
    // One string renders on both pages; only one of them has a list below it.
    const { EN_US_RESOURCES } = await import('@adminium/i18n/resources');
    const common = EN_US_RESOURCES.common as unknown as {
      security: { password: { changedBody: string } };
    };
    expect(common.security.password.changedBody.toLowerCase()).not.toContain('below');
  });
});
