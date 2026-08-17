// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PageSettingsBinding (M7 T6): the /me/notification-prefs matrix rendering,
 * the per-cell autosave PUT (optimistic flip → server truth → Saved), the
 * failed-save rollback (controlled matrix snaps back), and the
 * notification → feed-row mapper the queue-inbox feed overlay uses.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notificationFeedRow, type NotificationPrefsDto } from '../api/notifications.js';
import { PageSettingsBinding } from './PageSettingsBinding.js';
import type { PageTemplateProps } from './template-types.js';

const PAGE: PageEnvelope = {
  v: 1,
  kind: 'page',
  id: 'page_notification-settings',
  template: 'page-settings',
  title: { key: 'nav.notification-settings', fallback: 'Notification Settings' },
  source: { connectionId: null, table: null },
  nav: { group: 'account', icon: 'bell', order: 90 },
  access: { minRole: 'viewer', permissions: [] },
  config: {},
};

const ADAPTERS: PageTemplateProps['adapters'] = {
  crud: null,
  dashboard: null,
  onEvent: () => undefined,
  openRecord: () => undefined,
  notifyUndoable: () => undefined,
};

const PREFS: NotificationPrefsDto = {
  channels: [
    { id: 'inApp', available: true },
    { id: 'email', available: false, reason: 'No email transport (SMTP) is configured.' },
    { id: 'push', available: false, reason: 'Push delivery arrives in a later release.' },
  ],
  events: [
    {
      key: 'report.ready',
      channels: { inApp: true, email: true, push: false },
      custom: false,
    },
  ],
};

function renderWithClient(ui: ReactElement, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

function matrixCell(rowLabel: string, colLabel: string) {
  return screen.getAllByRole('button').find((el) => {
    const name = el.getAttribute('aria-label') ?? '';
    return name.includes(rowLabel) && name.includes(colLabel);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageSettingsBinding', () => {
  it('renders the prefs matrix and explains the unavailable email channel', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(<PageSettingsBinding page={PAGE} adapters={ADAPTERS} />, (client) => {
      client.setQueryData(['notifications', 'prefs'], PREFS);
    });

    expect(screen.getByText('Notification Settings')).toBeTruthy();
    expect(screen.getByText('Scheduled report ready')).toBeTruthy();
    // §8.2: server reason verbatim, column present + tagged.
    expect(screen.getByText(/No email transport \(SMTP\) is configured\./)).toBeTruthy();
    expect(screen.getByText(/Email · Not available yet/)).toBeTruthy();
  });

  it('autosaves one cell: optimistic flip, PUT body, Saved indicator', async () => {
    const user = userEvent.setup();
    const reply: NotificationPrefsDto = {
      ...PREFS,
      events: [
        { key: 'report.ready', channels: { inApp: false, email: true, push: false }, custom: true },
      ],
    };
    // Method-aware: the mount refetch (GET) must keep serving the seeded
    // truth, or it would overwrite the cache with the post-save reply.
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(JSON.stringify({ data: init?.method === 'PUT' ? reply : PREFS }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderWithClient(
      <PageSettingsBinding page={PAGE} adapters={ADAPTERS} />,
      (client) => {
        client.setQueryData(['notifications', 'prefs'], PREFS);
      },
    );

    const cell = matrixCell('Scheduled report ready', 'In-app');
    expect(cell?.getAttribute('aria-pressed')).toBe('true');
    await user.click(cell as HTMLElement);

    // Optimistic flip is immediate; the PUT carries the whole channel row.
    expect(matrixCell('Scheduled report ready', 'In-app')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (call) => String(call[0]).includes('/me/notification-prefs') && call[1]?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({
        events: [{ key: 'report.ready', channels: { inApp: false, email: true, push: false } }],
      });
    });
    await waitFor(() => {
      const indicator = container.querySelector('[data-part="saved-indicator"]');
      expect(indicator?.getAttribute('data-state')).toBe('saved');
    });
  });

  it('rolls the cell back and explains when the PUT fails', async () => {
    const user = userEvent.setup();
    // GET keeps working (matrix renders); only the PUT fails.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(
            JSON.stringify({ error: { code: 'INTERNAL', message: 'The server said no.' } }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          )
        : new Response(JSON.stringify({ data: PREFS }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderWithClient(
      <PageSettingsBinding page={PAGE} adapters={ADAPTERS} />,
      (client) => {
        client.setQueryData(['notifications', 'prefs'], PREFS);
      },
    );

    await user.click(matrixCell('Scheduled report ready', 'In-app') as HTMLElement);
    await waitFor(() => {
      const indicator = container.querySelector('[data-part="saved-indicator"]');
      expect(indicator?.getAttribute('data-state')).toBe('error');
      expect(indicator?.textContent).toContain('The server said no.');
    });
    // Controlled rollback: the cell is visually back on.
    expect(matrixCell('Scheduled report ready', 'In-app')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('notificationFeedRow', () => {
  it('maps a notification onto the feed vocabulary', () => {
    expect(
      notificationFeedRow({
        id: 'ntf_1',
        kind: 'report.ready',
        actorLabel: 'Adminium',
        title: 'Report ready: Weekly customers',
        body: '3 rows · CSV data snapshot',
        entity: { exportId: 'exp_1' },
        actionUrl: '/exports',
        readAt: null,
        createdAt: Date.UTC(2026, 6, 17, 12, 0),
      }),
    ).toEqual({
      id: 'ntf_1',
      actor: 'Adminium',
      action: 'Report ready: Weekly customers',
      target: '3 rows · CSV data snapshot',
      ts: '2026-07-17T12:00:00.000Z',
      read: false,
      category: 'report',
    });
  });
});
