// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing in on the dashboard's own address with `?next=` naming one of the
 * dashboard's screens (a bookmark of the privacy page, a link a colleague
 * sent): the sign-in lands there, inside the dashboard, and not on the home
 * page. An API route, or anything off this origin, is never followed.
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

const push = vi.fn();
let search: { returnTo?: string | undefined; next?: string | undefined } = {};

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: () => Promise.resolve(), history: { push }, options: { context: { queryClient: { clear: () => undefined } } } }),
  useSearch: () => search,
}));

const assign = vi.fn();
const original = window.location;

beforeEach(() => {
  push.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }));
      if (url === '/api/v1/auth/login') return Promise.resolve(jsonResponse(200, { data: { user: { id: 'usr_1', name: 'Mo Owner', email: 'mo@shop.dev' } } }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: original });
});

async function signInWith(next: string | undefined) {
  search = { returnTo: undefined, next };
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider>
        <LoginPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Turn any database into a dashboard.');
  await userEvent.type(screen.getByLabelText('Email'), 'mo@shop.dev');
  await userEvent.type(screen.getByLabelText('Password'), 'stoneware2026');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in on the dashboard with ?next=', () => {
  it('lands on the dashboard screen it names', async () => {
    await signInWith('/studio/privacy?tab=person');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/studio/privacy?tab=person'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('never follows it to an API route: home instead', async () => {
    await signInWith('/api/v1/auth/logout');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('still opens an app’s screens as a document', async () => {
    await signInWith('/apps/maker/staff/today');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/maker/staff/today'));
    expect(push).not.toHaveBeenCalled();
  });
});
