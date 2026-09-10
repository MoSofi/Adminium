// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/setup` route, end to end (M10-T04, rewritten by 45-T10 when the
 * two-step wizard became six).
 *
 * Every guarantee the two-step wizard was pinned on still holds and is still
 * asserted here — the routing gate, telemetry defaulting to OFF, the consent
 * copy, the bridge hand-off, the 409 — against the wizard that replaced it.
 * What changed is WHERE the consent is asked: three screens after the account
 * is created, which is why the super-admin request now always carries both
 * answers false and the opt-in rides a separate settings write.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';

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

interface TelemetryCall {
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
  const telemetryCalls: TelemetryCall[] = [];
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
    // Step 4 asks where the meta store lives, once a session exists.
    if (url === '/api/v1/meta/placement' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, {
          data: { source: 'embedded', engine: 'sqlite', embedded: true, canRelocate: true, reason: null },
        }),
      );
    }
    // Step 6 writes the consent answers it just asked for.
    if (url === '/api/v1/settings/telemetry' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      telemetryCalls.push({ body });
      return Promise.resolve(jsonResponse(200, { data: body }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, setupCalls, telemetryCalls };
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

describe('first-run routing gate', () => {
  it('routes a fresh install from / to the wizard', async () => {
    const { router } = await renderAt('/', { required: true });
    expect(await screen.findByRole('heading', { name: 'What will you build first?' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('routes a fresh install from /login to the wizard — there is no account to sign into', async () => {
    const { router } = await renderAt('/login', { required: true });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/setup');
    });
    expect(screen.getByRole('heading', { name: 'What will you build first?' })).toBeDefined();
  });

  it('a bootstrapped instance cannot open the wizard — /setup redirects to /login', async () => {
    const { router } = await renderAt('/setup', { required: false });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(screen.queryByRole('heading', { name: 'What will you build first?' })).toBeNull();
  });

  it('a bootstrapped instance still gets the normal sign-in screen', async () => {
    const { router } = await renderAt('/login', { required: false });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('the six-step wizard, on the route', () => {
  // FormField appends a decorative "*" to required labels, so the label's text
  // content is "Email*" — anchor the match rather than asking for exact text.
  const emailField = () => screen.getByLabelText(/^Email/);
  const passwordField = () => screen.getByLabelText(/^Password/);
  const confirmField = () => screen.getByLabelText(/^Confirm password/);

  /** Steps 1 and 2 answer themselves: blank canvas, no database. */
  async function walkToAccount(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { name: 'What will you build first?' });
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { name: 'Create your account' });
  }

  async function createAccount(user: ReturnType<typeof userEvent.setup>) {
    await user.type(emailField(), 'ada@adminium.test');
    await user.type(passwordField(), 'correct-horse-battery');
    await user.type(confirmField(), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /Create account/ }));
  }

  /** …then past storage and team, onto the last screen. */
  async function walkToDone(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { name: 'Where Adminium keeps its own data' });
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { name: 'Bring your team' });
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('heading', { name: /You’re all set/ });
  }

  it('blocks the account step on a short password and a mismatch, without calling the server', async () => {
    const user = userEvent.setup();
    const { setupCalls } = await renderAt('/setup', { required: true });
    await walkToAccount(user);

    await user.type(emailField(), 'ada@adminium.test');
    await user.type(passwordField(), 'short');
    await user.type(confirmField(), 'nope');
    await user.click(screen.getByRole('button', { name: /Create account/ }));

    expect(screen.getByText('Use at least 10 characters.')).toBeDefined();
    expect(screen.getByText('Passwords do not match.')).toBeDefined();
    expect(setupCalls).toHaveLength(0);
  });

  it('states exactly what telemetry sends and what it never sends, with both switches OFF', async () => {
    const user = userEvent.setup();
    await renderAt('/setup', { required: true });
    await walkToAccount(user);
    await createAccount(user);
    await walkToDone(user);

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

  it('creates the super admin with both consents OFF — they have not been asked yet', async () => {
    const user = userEvent.setup();
    const { setupCalls } = await renderAt('/setup', { required: true });
    await walkToAccount(user);
    await createAccount(user);
    await screen.findByRole('heading', { name: 'Where Adminium keeps its own data' });

    expect(setupCalls).toHaveLength(1);
    expect(setupCalls[0]?.body.email).toBe('ada@adminium.test');
    expect(setupCalls[0]?.body.consent).toEqual({ telemetry: false, updateCheck: false });
  });

  it('writes the consent answers on the way out, and lands in the app', async () => {
    const user = userEvent.setup();
    const { telemetryCalls, router } = await renderAt('/setup', { required: true });
    await walkToAccount(user);
    await createAccount(user);
    await walkToDone(user);
    await user.click(screen.getByRole('button', { name: /Go to dashboard/ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(telemetryCalls).toHaveLength(1);
    expect(telemetryCalls[0]?.body).toEqual({ telemetry: false, updateCheck: false });
  });

  it('sends consent: true only after the operator flips the switches', async () => {
    const user = userEvent.setup();
    const { telemetryCalls } = await renderAt('/setup', { required: true });
    await walkToAccount(user);
    await createAccount(user);
    await walkToDone(user);

    await user.click(await screen.findByRole('switch', { name: /Share anonymous usage data/ }));
    await user.click(screen.getByRole('switch', { name: /Check for new releases/ }));
    await user.click(screen.getByRole('button', { name: /Go to dashboard/ }));

    await waitFor(() => expect(telemetryCalls).toHaveLength(1));
    expect(telemetryCalls[0]?.body).toEqual({ telemetry: true, updateCheck: true });
  });

  it('the consent switches are keyboard-operable', async () => {
    const user = userEvent.setup();
    const { telemetryCalls } = await renderAt('/setup', { required: true });
    await walkToAccount(user);
    await createAccount(user);
    await walkToDone(user);

    const telemetry = await screen.findByRole('switch', { name: /Share anonymous usage data/ });
    telemetry.focus();
    await user.keyboard(' ');
    expect(telemetry.getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('button', { name: /Go to dashboard/ }));
    await waitFor(() => expect(telemetryCalls).toHaveLength(1));
    expect(telemetryCalls[0]?.body).toEqual({ telemetry: true, updateCheck: false });
  });

  it('lands on the connect wizard instead when a bridge hand-off is waiting', async () => {
    // The path a fresh install takes when someone pastes a connection string on
    // adminium.dev: the site redirects to `/studio/connect?bridge=…`, the app
    // bounces to `/setup` because no account exists yet, and the ticket waits in
    // sessionStorage. Landing on `/` afterwards would strand it — the account
    // was never the thing they came to do.
    window.sessionStorage.setItem('adminium-bridge-ticket', 'tkt_123');
    try {
      const user = userEvent.setup();
      const { router } = await renderAt('/setup', { required: true });
      await walkToAccount(user);
      await createAccount(user);
      await walkToDone(user);
      await user.click(screen.getByRole('button', { name: /Go to dashboard/ }));

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/studio/connect');
      });
    } finally {
      window.sessionStorage.clear();
    }
  });

  it('explains a 409 instead of offering a retry that can never succeed', async () => {
    const user = userEvent.setup();
    await renderAt('/setup', { required: true, postStatus: 409 });
    await walkToAccount(user);
    await createAccount(user);

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('alert').textContent ?? '').toContain('already been set up');
    // Still on the account step: there is nothing to advance to.
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeDefined();
  });
});
