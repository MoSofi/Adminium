// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page follows a language that arrives AFTER its first paint.
 *
 * That is the ordinary sign-in on a new browser: the strings boot in the
 * browser's language, the page draws, and only then does the session say the
 * reader reads German (or Arabic), and the switch lands. The menu followed;
 * the Account pages stayed English until a reload, because TanStack Router
 * memoises every `Outlet` and match, so the root's re-render on the switch
 * never reached a page that reads the plain `t()`.
 *
 * Real router, real i18next instance, de_DE: German can only have come from
 * a bundle the switch fetched.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n, loadLocaleBundle, switchLocale } from '@adminium/i18n';

import { createQueryClient } from './query.js';
import { createAppRouter } from './router.js';
import { setI18nInstance } from '../i18n/t.js';
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

const SCHEDULE = { timezone: null, quiet: null, digestDay: null, digestTime: null, quietOn: false, summariesOn: false, fallbackTimezone: 'Europe/London' };

function stubFetch(): void {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
      if (url.startsWith('/api/v1/branding')) return Promise.resolve(jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }));
      if (url.startsWith('/api/v1/me/notification-schedule')) return Promise.resolve(jsonResponse(200, { data: SCHEDULE }));
      if (url.startsWith('/api/v1/me/notification-prefs')) {
        return Promise.resolve(jsonResponse(200, { data: { channels: [], events: [{ key: 'mention', channels: { inApp: true, email: true, push: false }, custom: false }] } }));
      }
      return Promise.resolve(jsonResponse(200, { data: [], overrides: {} }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setI18nInstance(null);
});

async function openInEnglish(path: string) {
  stubFetch();
  const i18n = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
  setI18nInstance(i18n);
  const router = createAppRouter(createQueryClient(), { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={router.options.context.queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return i18n;
}

describe('a page drawn before the reader’s language lands', () => {
  it('the Account page turns German when the switch lands after its first paint', async () => {
    const i18n = await openInEnglish('/account');
    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('heading', { name: 'Account', level: 2 })).toBeTruthy();

    await act(() => switchLocale(i18n, 'de_DE'));

    expect(await within(main).findByRole('heading', { name: 'Konto', level: 2 })).toBeTruthy();
    expect(within(main).queryByRole('heading', { name: 'Account', level: 2 })).toBeNull();
    // The top bar's title, which the shell works out once per path (a memo that has to follow the words too).
    expect(within(screen.getByRole('banner')).getByRole('heading', { level: 1 }).textContent).toBe('Konto');
  });

  it('the notification settings and their quiet-hours card turn German too', async () => {
    const i18n = await openInEnglish('/account/notifications');
    const card = within(await screen.findByTestId('quiet-hours'));
    expect(card.getByRole('heading', { name: 'Quiet hours' })).toBeTruthy();

    await act(() => switchLocale(i18n, 'de_DE'));

    expect(await card.findByRole('heading', { name: 'Ruhezeiten' })).toBeTruthy();
    // The page's own words, not only the card's: the title it hands the top bar.
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: 'Benachrichtigungseinstellungen', level: 2 })).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByRole('heading', { name: 'Benachrichtigungseinstellungen', level: 1 })).toBeTruthy();
  });
});
