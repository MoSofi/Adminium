// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the dashboard says on a server run by `adminium design`.
 *
 *  1. Opened as the preview's user in a tab of its own, it says whose eyes
 *     this is and where the person's own dashboard is: the Designer's name,
 *     made from the port and from nothing a screen said. Inside the Designer's
 *     frame it stays out of the picture.
 *  2. The owner with no password is offered the form: two passwords that
 *     differ are caught on the page, a refusal is shown on its own field, and
 *     a yes sends the address and the password once. It can be put away.
 *  3. Anyone else sees nothing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { AppToastProvider } from '../pages/toasts.js';
import { jsonResponse } from '../test/fixtures.js';
import { PREVIEW_USER_EMAIL } from './api.js';
import { DesignBanners, ownDashboardUrl } from './DesignBanners.js';

let restoreI18n: () => void;
let needs: boolean;
let posted: Record<string, unknown>[];
let answer: () => Response;

beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
beforeEach(() => {
  needs = true;
  posted = [];
  answer = () => jsonResponse(200, { email: 'sam@example.test' });
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/designer/state') return Promise.resolve(jsonResponse(200, { mode: 'local', project: 'bakery', limits: { maxSteps: 60, turnTokens: 1, sessionTokens: 1 }, active: null, ownerNeedsPassword: needs }));
      if (url === '/api/v1/designer/owner-password') {
        posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const reply = answer();
        if (reply.ok) needs = false;
        return Promise.resolve(reply);
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Mounted inside an awaited act: the banners wait for the Designer's words before they draw. */
async function mount(email: string, roles: string[] = ['super-admin']): Promise<void> {
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppToastProvider>
          <Suspense fallback={null}>
            <DesignBanners email={email} roles={roles} />
          </Suspense>
        </AppToastProvider>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
}

describe('the dashboard on a `design` server', () => {
  it('says a preview is a preview, as whom, and where the person’s own dashboard is', async () => {
    await mount(PREVIEW_USER_EMAIL, ['bakery-staff']);
    const bar = await screen.findByRole('status');
    expect(bar.textContent).toContain('This is a preview of the app, seen as its staff (bakery-staff). It is not your own sign-in');
    expect(screen.getByRole('link', { name: 'Open the dashboard as yourself' }).getAttribute('href')).toBe(ownDashboardUrl());
    expect(ownDashboardUrl({ protocol: 'http:', port: '4766' })).toBe('http://127.0.0.1:4766/');
    // No password form for the preview's user, whatever the server says.
    expect(screen.queryByRole('button', { name: 'Set your password' })).toBeNull();
  });

  it('offers the owner with no password the form, and sends it once', async () => {
    await mount('owner@adminium.localhost');
    await userEvent.click(await screen.findByRole('button', { name: 'Set your password' }));
    await userEvent.type(screen.getByLabelText(/Your email address/), 'sam@example.test');
    await userEvent.type(screen.getByLabelText(/^A password/), 'a-long-enough-password-1!');
    await userEvent.type(screen.getByLabelText(/The same password again/), 'something else');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('The two passwords are not the same.')).toBeTruthy();
    expect(posted).toEqual([]);

    // The server's own refusal lands on the field it is about.
    answer = () => jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'A password has at least 12 characters.', requestId: 'r', details: { reason: 'PASSWORD' } } });
    await userEvent.clear(screen.getByLabelText(/The same password again/));
    await userEvent.type(screen.getByLabelText(/The same password again/), 'a-long-enough-password-1!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A password has at least 12 characters.')).toBeTruthy();

    answer = () => jsonResponse(200, { email: 'sam@example.test' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your owner account' })).toBeNull());
    expect(posted.at(-1)).toEqual({ email: 'sam@example.test', password: 'a-long-enough-password-1!' });
    expect(await screen.findByText('You now sign in as sam@example.test, with your password.')).toBeTruthy();
  });

  it('says who signed the owner in: the link in a browser, the app in the app (which prints no link)', async () => {
    await mount('owner@adminium.localhost');
    expect((await screen.findByRole('region', { name: 'Your owner account' })).textContent).toContain('signed in by the link Adminium Designer printed');
    cleanup();
    (window as unknown as { adminiumDesktop?: unknown }).adminiumDesktop = {};
    try {
      await mount('owner@adminium.localhost');
      const region = await screen.findByRole('region', { name: 'Your owner account' });
      expect(region.textContent).toContain('signed in by the Adminium app on this computer');
      expect(region.textContent).not.toContain('printed');
    } finally {
      delete (window as unknown as { adminiumDesktop?: unknown }).adminiumDesktop;
    }
  });

  it('can be put away, and shows nothing to an owner who has a password', async () => {
    await mount('owner@adminium.localhost');
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Your owner account' })).toBeNull();
    expect(window.sessionStorage.getItem('adminium.design.owner-banner')).toBe('1');
  });

  it('says nothing where the owner already has a password', async () => {
    needs = false;
    await mount('sam@example.test');
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Your owner account' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
