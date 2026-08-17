/**
 * The topbar notification bell AS THE PRODUCT RENDERS IT (M7 T6 wave-2 fix):
 * the wave shipped the whole notifications stack — routes, meta tables, WS
 * channel, feed mapper — while the bell stayed a "arrives with M7" placeholder
 * and NOTHING surfaced the unread count or the feed (the compiles-green,
 * dead-in-the-app class). This renders the REAL `Topbar` and asserts the two
 * reachability claims: the bell shows the live unread count, and opening it
 * renders the `/me/notifications` rows, marks them read, and follows the
 * server-authored `actionUrl`.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, TooltipProvider } from '@adminium/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notificationsApi, type NotificationsPage } from '../api/notifications.js';
import { createQueryClient } from '../app/query.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShortcutsProvider } from './ShortcutsProvider.js';
import { Topbar } from './Topbar.js';

const historyPush = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useRouter: () => ({ history: { push: historyPush } }),
    useNavigate: () => vi.fn(),
  };
});

const FEED: NotificationsPage = {
  items: [
    {
      id: 'ntf_1',
      kind: 'report.ready',
      actorLabel: 'Adminium',
      title: 'Report ready: Weekly customers',
      body: '3 rows · CSV data snapshot',
      entity: { exportId: 'exp_1' },
      actionUrl: '/exports',
      readAt: null,
      createdAt: Date.now() - 60_000,
    },
    {
      id: 'ntf_2',
      kind: 'report.failed',
      actorLabel: 'Adminium',
      title: 'Report failed: Ops digest',
      body: 'The report’s page no longer exists.',
      entity: null,
      actionUrl: '/reports',
      readAt: Date.now() - 3_000_000,
      createdAt: Date.now() - 3_600_000,
    },
  ],
  unreadCount: 1,
  nextCursor: null,
};

function stubFetch(feed: NotificationsPage) {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/me/notifications')) {
      return Promise.resolve(jsonResponse(200, { data: feed }));
    }
    if (url.startsWith('/api/v1/system/info')) {
      return Promise.resolve(
        jsonResponse(200, {
          version: '0.5.0',
          node: 'v22.0.0',
          dialect: 'sqlite',
          runtime: 'self-host',
          smtpConfigured: false,
          networkFeaturesAllowed: true,
        }),
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
  vi.restoreAllMocks();
  historyPush.mockClear();
});

describe('the notification bell in the real Topbar', () => {
  it('shows the live unread count on the bell, inside the topbar', async () => {
    stubFetch(FEED);
    renderTopbar();

    const badge = await screen.findByText('1');
    expect(badge.getAttribute('data-part')).toBe('topbar-unread-badge');
    expect(badge.closest('[data-part="topbar"]')).not.toBeNull();
  });

  it('opening the bell renders the feed rows and marks everything read', async () => {
    stubFetch(FEED);
    const markAll = vi
      .spyOn(notificationsApi, 'markAllRead')
      .mockResolvedValue({ updated: 1, unreadCount: 0 });
    renderTopbar();
    await screen.findByText('1');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Notifications' }));

    // The real /me/notifications rows — title + body — render in the popover.
    expect(await screen.findByText('Report ready: Weekly customers')).toBeDefined();
    expect(screen.getByText('3 rows · CSV data snapshot')).toBeDefined();
    expect(screen.getByText('Report failed: Ops digest')).toBeDefined();
    // Unread affordance: exactly the unread row carries the dot.
    expect(document.querySelectorAll('[data-part="notification-unread-dot"]')).toHaveLength(1);
    // Opening the feed IS seeing it — the badge's read-all fires.
    await waitFor(() => {
      expect(markAll).toHaveBeenCalledTimes(1);
    });
  });

  it('clicking a notification follows its server-authored actionUrl', async () => {
    stubFetch(FEED);
    vi.spyOn(notificationsApi, 'markAllRead').mockResolvedValue({ updated: 1, unreadCount: 0 });
    renderTopbar();
    await screen.findByText('1');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByText('Report ready: Weekly customers'));

    expect(historyPush).toHaveBeenCalledWith('/exports');
  });

  it('an empty feed renders the all-caught-up copy, never the old placeholder', async () => {
    stubFetch({ items: [], unreadCount: 0, nextCursor: null });
    renderTopbar();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText('You’re all caught up.')).toBeDefined();
    // The stale "(M7)" deferral copy is gone for good.
    expect(screen.queryByText(/notification center \(M7\)/)).toBeNull();
  });
});
