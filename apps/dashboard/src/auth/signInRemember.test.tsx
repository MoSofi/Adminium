// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Keep me signed in" reaches the server. The box starts ticked — as both
 * sign-in comps draw it, and matching the long-lived cookie every sign-in got
 * before it did anything — and whatever it says at submit is what
 * POST /auth/login receives as `remember`. Covered on Adminium's own sign-in
 * and on an app's staff address, whose label is the tablet's.
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
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    history: { push: () => undefined },
    options: { context: { queryClient: { clear: () => undefined } } },
  }),
  useSearch: () => ({ returnTo: undefined, next: undefined }),
}));

const STAFF_BRANDING = {
  appName: 'Daybreak Coffee',
  logoUrl: null,
  showVersion: false,
  surface: { appKey: 'pos', appName: 'Point of Sale', name: 'Daybreak Coffee' },
};

let branding: unknown;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  branding = { appName: 'Adminium', logoUrl: null, showVersion: true };
  fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: branding }));
    if (url === '/api/v1/auth/login') {
      return Promise.resolve(jsonResponse(200, { data: { user: { id: 'usr_1', name: 'Ava Reyes' } } }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/** The body of the one POST /auth/login the page made. */
async function loginBody(): Promise<unknown> {
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/auth/login')).toBe(true),
  );
  const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/auth/login') as [
    string,
    RequestInit,
  ];
  return JSON.parse(String(call[1].body)) as unknown;
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'ava@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('“Keep me signed in” on Adminium’s sign-in', () => {
  it('starts ticked and sends remember: true', async () => {
    renderPage();
    const box = await screen.findByRole('checkbox', { name: 'Keep me signed in' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    await fillAndSubmit();
    expect(await loginBody()).toEqual({ email: 'ava@example.com', password: 'correct-horse', remember: true });
  });

  it('sends remember: false once unticked', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Keep me signed in' }));
    await fillAndSubmit();
    expect(await loginBody()).toMatchObject({ remember: false });
  });
});

describe('“Keep me signed in on this tablet” on an app’s staff address', () => {
  beforeEach(() => {
    branding = STAFF_BRANDING;
  });

  it('starts ticked and sends remember: true', async () => {
    renderPage();
    const box = await screen.findByRole('checkbox', { name: 'Keep me signed in on this tablet' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    await fillAndSubmit();
    expect(await loginBody()).toMatchObject({ remember: true });
  });

  it('sends remember: false once unticked', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Keep me signed in on this tablet' }));
    await fillAndSubmit();
    expect(await loginBody()).toMatchObject({ remember: false });
  });
});
