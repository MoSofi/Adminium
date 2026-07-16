/**
 * First-run wizard + routing gate (M10-T04):
 *  - a fresh install routes to `/setup` from `/` and from `/login`;
 *  - the wizard creates the super admin and lands in the app;
 *  - telemetry defaults to OFF and is only sent as `true` after a deliberate flip;
 *  - the consent screen states exactly what is (and is not) sent;
 *  - a bootstrapped instance can never reach `/setup`;
 *  - a 409 (someone else finished setup first) is explained, not retried.
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
import { validateAccount } from './FirstRunWizard.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface SetupCall {
  body: Record<string, unknown>;
}

interface StubOptions {
  /** Server-side setup state. */
  required: boolean;
  /** Status for POST /setup/super-admin. */
  postStatus?: number;
  /** Once true, /bootstrap answers 200 instead of 401. */
  authed?: boolean;
}

function stubFetch(opts: StubOptions) {
  const setupCalls: SetupCall[] = [];
  let authed = opts.authed ?? false;

  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        authed
          ? jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) })
          : jsonResponse(401, {
              error: { code: 'UNAUTHENTICATED', message: 'no session', requestId: 'req_t' },
            }),
      );
    }
    if (url === '/api/v1/setup/state' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, { data: { required: opts.required, passwordMinLength: 10 } }),
      );
    }
    if (url === '/api/v1/setup/super-admin' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      setupCalls.push({ body });
      const status = opts.postStatus ?? 201;
      if (status !== 201) {
        return Promise.resolve(
          jsonResponse(status, {
            error: { code: 'CONFLICT', message: 'already set up', requestId: 'req_t' },
          }),
        );
      }
      authed = true; // the server signed us in
      return Promise.resolve(
        jsonResponse(201, {
          data: { user: { id: 'usr_1', email: String(body.email), name: 'Ada' } },
        }),
      );
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, setupCalls };
}

async function renderAt(path: string, opts: StubOptions) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(opts);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, router, queryClient };
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

describe('validateAccount', () => {
  const base = { name: 'Ada', email: 'ada@adminium.test', password: 'a-long-password', confirm: 'a-long-password' };

  it('accepts a well-formed account', () => {
    expect(validateAccount(base, 10)).toEqual({});
  });

  it('rejects a malformed email', () => {
    expect(validateAccount({ ...base, email: 'nope' }, 10).email).toBeTypeOf('string');
  });

  it('enforces the server-supplied minimum length', () => {
    expect(validateAccount({ ...base, password: 'short', confirm: 'short' }, 10).password).toBeTypeOf('string');
    // The floor is the server's, not a hardcoded one.
    expect(validateAccount({ ...base, password: 'abcdefghij', confirm: 'abcdefghij' }, 24).password).toBeTypeOf('string');
  });

  it('rejects a mismatched confirmation', () => {
    expect(validateAccount({ ...base, confirm: 'different' }, 10).confirm).toBeTypeOf('string');
  });
});

describe('first-run routing gate', () => {
  it('routes a fresh install from / to the wizard', async () => {
    const { router } = await renderAt('/', { required: true });
    expect(await screen.findByRole('heading', { name: 'Set up Adminium' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('routes a fresh install from /login to the wizard — there is no account to sign into', async () => {
    const { router } = await renderAt('/login', { required: true });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/setup');
    });
    expect(screen.getByRole('heading', { name: 'Set up Adminium' })).toBeDefined();
  });

  it('a bootstrapped instance cannot open the wizard — /setup redirects to /login', async () => {
    const { router } = await renderAt('/setup', { required: false });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(screen.queryByRole('heading', { name: 'Set up Adminium' })).toBeNull();
  });

  it('a bootstrapped instance still gets the normal sign-in screen', async () => {
    const { router } = await renderAt('/login', { required: false });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('FirstRunWizard', () => {
  // FormField appends a decorative "*" to required labels, so the label's text
  // content is "Email*" — anchor the match rather than asking for exact text.
  const emailField = () => screen.getByLabelText(/^Email/);
  const passwordField = () => screen.getByLabelText(/^Password/);
  const confirmField = () => screen.getByLabelText(/^Confirm password/);

  async function fillAccount(user: ReturnType<typeof userEvent.setup>) {
    await user.type(emailField(), 'ada@adminium.test');
    await user.type(passwordField(), 'correct-horse-battery');
    await user.type(confirmField(), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('blocks the account step on a short password and a mismatch, without calling the server', async () => {
    const user = userEvent.setup();
    const { setupCalls } = await renderAt('/setup', { required: true });
    await screen.findByRole('heading', { name: 'Set up Adminium' });

    await user.type(emailField(), 'ada@adminium.test');
    await user.type(passwordField(), 'short');
    await user.type(confirmField(), 'nope');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Use at least 10 characters.')).toBeDefined();
    expect(screen.getByText('Passwords do not match.')).toBeDefined();
    expect(setupCalls).toHaveLength(0);
  });

  it('states exactly what telemetry sends and what it never sends, with both switches OFF', async () => {
    const user = userEvent.setup();
    await renderAt('/setup', { required: true });
    await screen.findByRole('heading', { name: 'Set up Adminium' });
    await fillAccount(user);

    // Opt-in: nothing is pre-checked.
    const telemetry = await screen.findByRole('switch', { name: /Share anonymous usage data/ });
    const updates = screen.getByRole('switch', { name: /Check for new releases/ });
    expect(telemetry.getAttribute('aria-checked')).toBe('false');
    expect(updates.getAttribute('aria-checked')).toBe('false');

    // The disclosure is specific, not "anonymous usage data" hand-waving.
    expect(screen.getByText('Exactly what is sent:')).toBeDefined();
    expect(screen.getByText(/A random instance ID/)).toBeDefined();
    expect(screen.getByText(/The Adminium version this instance runs/)).toBeDefined();
    expect(screen.getByText('Never sent:')).toBeDefined();
    expect(screen.getByText(/no table, column, or enum names/)).toBeDefined();
    expect(screen.getByText(/not a single row, ever/)).toBeDefined();
    expect(screen.getByText(/Connection strings, hostnames, or credentials/)).toBeDefined();
    expect(screen.getByText(/AI prompts or run contents/)).toBeDefined();
  });

  it('creates the super admin with telemetry OFF when the operator does not opt in', async () => {
    const user = userEvent.setup();
    const { setupCalls, router } = await renderAt('/setup', { required: true });
    await screen.findByRole('heading', { name: 'Set up Adminium' });
    await fillAccount(user);

    await user.click(await screen.findByRole('button', { name: 'Create admin account' }));

    await waitFor(() => {
      expect(setupCalls).toHaveLength(1);
    });
    expect(setupCalls[0]?.body).toMatchObject({
      email: 'ada@adminium.test',
      password: 'correct-horse-battery',
      consent: { telemetry: false, updateCheck: false },
    });

    // Landed inside the app, signed in — no second trip through /login.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('sends consent: true only after the operator flips the switches', async () => {
    const user = userEvent.setup();
    const { setupCalls } = await renderAt('/setup', { required: true });
    await screen.findByRole('heading', { name: 'Set up Adminium' });
    await fillAccount(user);

    await user.click(await screen.findByRole('switch', { name: /Share anonymous usage data/ }));
    await user.click(screen.getByRole('switch', { name: /Check for new releases/ }));
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    await waitFor(() => {
      expect(setupCalls).toHaveLength(1);
    });
    expect(setupCalls[0]?.body).toMatchObject({ consent: { telemetry: true, updateCheck: true } });
  });

  it('the consent switches are keyboard-operable', async () => {
    const user = userEvent.setup();
    await renderAt('/setup', { required: true });
    await screen.findByRole('heading', { name: 'Set up Adminium' });
    await fillAccount(user);

    const telemetry = await screen.findByRole('switch', { name: /Share anonymous usage data/ });
    telemetry.focus();
    await user.keyboard(' ');
    expect(telemetry.getAttribute('aria-checked')).toBe('true');
  });

  it('explains a 409 instead of offering a retry that can never succeed', async () => {
    const user = userEvent.setup();
    await renderAt('/setup', { required: true, postStatus: 409 });
    await screen.findByRole('heading', { name: 'Set up Adminium' });
    await fillAccount(user);
    await user.click(await screen.findByRole('button', { name: 'Create admin account' }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/already been set up/)).toBeDefined();
  });
});
