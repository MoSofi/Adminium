// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/account` integration: the profile form over `PATCH /api/v1/me`, plus the
 * one navigation this page's siblings depend on.
 *
 * Two of these assert things that were BROKEN, not merely unproven. The
 * account page rendered name and email as dead text over a route that had
 * accepted a patch since M2, and the avatar menu's "Preferences" item shared
 * `onOpenAccount` with "Profile" — so it landed here and `/account/preferences`
 * was reachable only by typing the URL. Both are cheap to re-break by
 * deleting a prop, which is why the menu case is asserted through the real
 * router rather than by spying on a handler.
 *
 * The password assertions are about the SHAPE OF THE REQUEST, not about
 * authentication: the server re-verifies the password itself and refuses an
 * email change without one. What the UI owes is (a) not prompting for it on a
 * name-only edit and (b) not sending it speculatively when it did prompt.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { profileDiff } from './AccountPage.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface PatchCall {
  body: Record<string, unknown>;
}

/** `null` reply = let the handler answer 200 with the patched user. */
function stubFetch(patchReply: { status: number; body: unknown } | null = null) {
  const patchCalls: PatchCall[] = [];
  const passwordCalls: PatchCall[] = [];
  const user = makeBootstrap().user;
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/me' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      patchCalls.push({ body });
      if (patchReply !== null) {
        return Promise.resolve(jsonResponse(patchReply.status, patchReply.body));
      }
      return Promise.resolve(jsonResponse(200, { data: { user: { ...user, ...body, password: undefined } } }));
    }
    if (url === '/api/v1/auth/password/change' && method === 'POST') {
      passwordCalls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    }
    if (url.startsWith('/api/v1/me/prefs')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: {
            prefs: { theme: null, accent: null, density: null, locale: null, dir: null },
            resolved: makeBootstrap().prefs,
          },
        }),
      );
    }
    if (url.startsWith('/api/v1/me/notifications')) {
      return Promise.resolve(
        jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }),
      );
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, patchCalls, passwordCalls };
}

async function renderAccount(patchReply?: { status: number; body: unknown }) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(patchReply ?? null);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/account'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // NOT the "Account" heading: the topbar derives its own <h1> from the path
  // and renders it before the lazy route chunk resolves, so waiting on that
  // races the page in — and once the page IS in, two headings match it.
  await screen.findByTestId('account-name');
  return { ...stub, queryClient, router };
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

describe('profileDiff', () => {
  const user = { name: 'Ava Reyes', email: 'ava@adminium.io' };

  it('reports nothing when the draft matches the session user', () => {
    expect(profileDiff(user, { name: 'Ava Reyes', email: 'ava@adminium.io' })).toEqual({});
  });

  it('ignores case and surrounding space on email, because the server lowercases it', () => {
    // Without this, re-typing your own address in title case would demand a
    // password to save a change the server would discard as a no-op.
    expect(profileDiff(user, { name: 'Ava Reyes', email: '  Ava@Adminium.IO ' })).toEqual({});
  });

  it('reports each field independently', () => {
    expect(profileDiff(user, { name: 'Ava R.', email: 'ava@adminium.io' })).toEqual({ name: 'Ava R.' });
    expect(profileDiff(user, { name: 'Ava Reyes', email: 'ava@new.io' })).toEqual({ email: 'ava@new.io' });
  });
});

describe('AccountPage', () => {
  it('saves a name change without ever asking for a password', async () => {
    const user = userEvent.setup();
    const { patchCalls } = await renderAccount();

    const name = screen.getByTestId('account-name');
    await user.clear(name);
    await user.type(name, 'Ava R.');

    // The prompt is keyed to the email being dirty — a name edit must not
    // raise it, or every rename becomes a re-authentication.
    expect(screen.queryByTestId('account-password')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]?.body).toEqual({ name: 'Ava R.' });
    await screen.findByTestId('account-saved');
  });

  it('demands the password before an email change, and sends it', async () => {
    const user = userEvent.setup();
    const { patchCalls } = await renderAccount();

    const email = screen.getByTestId('account-email');
    await user.clear(email);
    await user.type(email, 'ava@new.io');

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.hasAttribute('disabled')).toBe(true);

    await user.type(await screen.findByTestId('account-password'), 'hunter2');
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]?.body).toEqual({ email: 'ava@new.io', password: 'hunter2' });
  });

  it('surfaces a rejected email change instead of pretending it saved', async () => {
    const user = userEvent.setup();
    await renderAccount({
      status: 409,
      body: {
        error: { code: 'UNIQUE_VIOLATION', message: 'That email is already in use.', requestId: 'req_t' },
      },
    });

    const email = screen.getByTestId('account-email');
    await user.clear(email);
    await user.type(email, 'taken@adminium.io');
    await user.type(await screen.findByTestId('account-password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByTestId('account-error');
    expect(alert.textContent).toContain('That email is already in use.');
    expect(screen.queryByTestId('account-saved')).toBeNull();
  });

  it('offers a door to two-factor rather than a dead "Off" label', async () => {
    await renderAccount();
    // The enrolment flow lives on /account/security and cannot be halved, so
    // the account page's job is to link to it, not to restate its state.
    const link = screen.getByRole('link', { name: 'Set up' });
    expect(link.getAttribute('href')).toBe('/account/security');
  });

  it('changes the password, sending only what the server takes', async () => {
    const user = userEvent.setup();
    const { passwordCalls } = await renderAccount();

    await user.type(screen.getByTestId('password-current'), 'old-password');
    await user.type(screen.getByTestId('password-new'), 'new-password');
    await user.type(screen.getByTestId('password-confirm'), 'new-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(passwordCalls).toHaveLength(1));
    // The confirmation field is a typing check that never leaves the browser —
    // the server has no third field to compare it against.
    expect(passwordCalls[0]?.body).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    await screen.findByTestId('security-password-ok');
  });

  it('refuses to submit a mismatched confirmation', async () => {
    const user = userEvent.setup();
    const { passwordCalls } = await renderAccount();

    await user.type(screen.getByTestId('password-current'), 'old-password');
    await user.type(screen.getByTestId('password-new'), 'new-password');
    await user.type(screen.getByTestId('password-confirm'), 'new-passwerd');

    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('The two passwords do not match.')).toBeDefined();
    expect(passwordCalls).toHaveLength(0);
  });

  it('sends the avatar menu’s Preferences item to /account/preferences', async () => {
    const user = userEvent.setup();
    const { router } = await renderAccount();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Preferences' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account/preferences');
    });
  });
});
