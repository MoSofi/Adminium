// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing in on an app's own staff address (`App Address Pages.dc.html`): the
 * venue's page, not Adminium's — its name and the app's over the form, no
 * marketing panel, the tablet's words — and "Opening {app}…" while the app's
 * screens load.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider } from '@adminium/ui';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse } from '../test/fixtures.js';
import { LoginPage } from './LoginPage.js';

const restoreI18n = installTestI18n();
afterAll(restoreI18n);

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: () => Promise.resolve(), history: { push: () => undefined }, options: { context: { queryClient: { clear: () => undefined } } } }),
  useSearch: () => ({ returnTo: undefined, next: '/' }),
}));

const STAFF_BRANDING = {
  appName: 'Daybreak Coffee',
  logoUrl: null,
  showVersion: false,
  surface: { appKey: 'pos', appName: 'Point of Sale', name: 'Daybreak Coffee' },
};

let loginReply: { status: number; body: unknown };
let branding: unknown;
const assign = vi.fn();
const original = window.location;

beforeEach(() => {
  loginReply = { status: 200, body: { data: { user: { id: 'usr_1', name: 'Ava Reyes', email: 'ava@daybreak.coffee' } } } };
  branding = STAFF_BRANDING;
  assign.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: branding }));
      if (url === '/api/v1/auth/login') return Promise.resolve(jsonResponse(loginReply.status, loginReply.body));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: original });
});

function renderPage() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider>
        <LoginPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function signIn() {
  await userEvent.type(screen.getByLabelText('Email'), 'ava@daybreak.coffee');
  await userEvent.type(screen.getByLabelText('Password'), 'latteart2026');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in on an app’s staff address', () => {
  it('is the venue’s page: its name and the app’s, the tablet’s words, no marketing', async () => {
    renderPage();
    expect(await screen.findByText('Point of Sale · Staff sign-in')).toBeTruthy();
    expect(screen.getByText('Daybreak Coffee')).toBeTruthy();
    expect(screen.getByText('Shared tablet? Everyone signs in with their own account.')).toBeTruthy();
    expect(screen.getByLabelText('Keep me signed in on this tablet')).toBeTruthy();
    expect(screen.queryByText('Turn any database into a dashboard.')).toBeNull();
    expect(document.querySelector('[data-variant="single"]')).not.toBeNull();
  });

  it('says what went wrong in the tablet’s words', async () => {
    loginReply = { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'no', requestId: 'r' } } };
    renderPage();
    await screen.findByText('Point of Sale · Staff sign-in');
    await signIn();
    expect(await screen.findByText('We couldn’t sign you in. Check your email and password, then try again.')).toBeTruthy();
    loginReply = { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down', requestId: 'r' } } };
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Too many tries. Try again in a minute.')).toBeTruthy();
  });

  it('shows the handover while the app’s screens load', async () => {
    renderPage();
    await screen.findByText('Point of Sale · Staff sign-in');
    await signIn();
    expect(await screen.findByText('Opening Point of Sale…')).toBeTruthy();
    expect(screen.getByText('Signed in as Ava Reyes')).toBeTruthy();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  it('keeps Adminium’s own sign-in everywhere else', async () => {
    branding = { appName: 'Adminium', logoUrl: null, showVersion: true };
    renderPage();
    expect(await screen.findByText('Turn any database into a dashboard.')).toBeTruthy();
    expect(screen.queryByText(/Staff sign-in/)).toBeNull();
  });
});
