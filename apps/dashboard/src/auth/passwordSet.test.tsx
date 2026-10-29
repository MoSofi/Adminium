// SPDX-License-Identifier: AGPL-3.0-only
/**
 * V28: an invited helper chose a password on a page that said "at least 8"
 * (the policy is 10 by default) and then met "Welcome back".
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
import { ResetPage } from './ResetPage.js';

const restoreI18n = installTestI18n();
afterAll(restoreI18n);

const navigate = vi.fn(() => Promise.resolve());
let search: Record<string, unknown> = {};
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate,
    history: { push: () => undefined },
    options: { context: { queryClient: { clear: () => undefined } } },
  }),
  useSearch: () => search,
  useParams: () => ({ token: 'admr_test' }),
}));

beforeEach(() => {
  search = {};
  navigate.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }));
      if (url === '/api/v1/setup/state') {
        return Promise.resolve(jsonResponse(200, { data: { required: false, passwordMinLength: 10, databaseConnected: true } }));
      }
      if (url === '/api/v1/auth/password/reset') return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderIt(node: React.ReactNode) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider resolveDir={() => 'ltr'}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('choosing a password', () => {
  it('asks for the workspace’s own minimum, and refuses one shorter', async () => {
    renderIt(<ResetPage />);
    expect(await screen.findByText('Must be at least 10 characters.')).toBeDefined();
    await userEvent.type(screen.getByLabelText('Password'), 'nine-char');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'nine-char');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeDefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends the person to sign in, saying the password was saved', async () => {
    renderIt(<ResetPage />);
    await screen.findByText('Must be at least 10 characters.');
    await userEvent.type(screen.getByLabelText('Password'), 'ten-chars!!');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'ten-chars!!');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login', search: { passwordSet: '1' } }));
  });
});

describe('the sign-in screen after it', () => {
  it('says "Password saved", not "Welcome back"', async () => {
    search = { passwordSet: '1' };
    renderIt(<LoginPage />);
    expect(await screen.findByText('Password saved')).toBeDefined();
    expect(screen.queryByText('Welcome back')).toBeNull();
  });

  it('greets as before otherwise', async () => {
    renderIt(<LoginPage />);
    expect(await screen.findByText('Welcome back')).toBeDefined();
  });
});
