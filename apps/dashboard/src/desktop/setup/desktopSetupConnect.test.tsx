// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/desktop/setup` step 4 with a server database (card 3) — finding V29.
 *
 * Before the fix, step 4 went straight to `POST /connections`, which SAVES a
 * connection whose login fails, and took the 202 introspect JOB a Postgres
 * read answers with for success. A wrong password walked on to Generate and
 * ended on an empty app; nothing said why. These walk the three paths that
 * mattered on a real Supabase project (yt-03's rehearsal, 2026-10-30):
 *
 *  - a refused login stops BEFORE anything is created, says why (with the
 *    pooler's user rule on Supabase), and leads back to step 2 — past the
 *    account, which already exists — and from there straight to step 4;
 *  - the introspect job is waited for, and its failure is shown;
 *  - Try again after a failed read reads again instead of skipping to Generate.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { setCsrfToken } from '../../app/api.js';
import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { INITIAL_DESKTOP_SETUP_STATE } from './desktopSetupState.js';

const STORAGE_KEY = 'adminium-desktop-setup';
const WRONG = 'postgresql://postgres.abcdefghijklmnop:nope@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
const RIGHT = 'postgresql://adminium_rw.abcdefghijklmnop:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

/** Step 4 after a reload: the account exists, card 3 is chosen with `dsn`. */
function seedAtGenerate(dsn: string, extra: Record<string, unknown> = {}): void {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...INITIAL_DESKTOP_SETUP_STATE,
      step: 'generate',
      accountCreated: true,
      source: 'remote',
      remoteName: 'Crumb & Co.',
      remoteEngine: 'postgres',
      remoteDsn: dsn,
      ...extra,
    }),
  );
}

interface Server {
  /** The DSN of each `POST /connections/test`, in order. */
  probes: string[];
  creates: number;
  introspects: number;
  /** How each introspect job ends, in order; the last one repeats. */
  jobEnds: ('succeeded' | 'failed')[];
}

function stubServer(server: Server): void {
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ csrfToken: 'tok' }) }));
    }
    if (url === '/api/v1/connections/test' && method === 'POST') {
      const { dsn } = JSON.parse(init?.body ?? '{}') as { dsn: string };
      server.probes.push(dsn);
      if (dsn === RIGHT) {
        return Promise.resolve(
          jsonResponse(200, { ok: true, latencyMs: 300, serverVersion: '17', readOnly: false, privileges: null, error: null }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, {
          ok: false,
          latencyMs: 700,
          serverVersion: null,
          readOnly: true,
          privileges: null,
          error: {
            code: 'AUTH',
            message: 'postgres query failed: password authentication failed for user "postgres"',
            hint: 'check the username, password, and database name in the connection string',
          },
        }),
      );
    }
    if (url === '/api/v1/connections' && method === 'POST') {
      server.creates += 1;
      return Promise.resolve(jsonResponse(201, { id: 'conn_crumb', name: 'Crumb & Co.', readOnly: false }));
    }
    if (url === '/api/v1/connections/conn_crumb/introspect') {
      server.introspects += 1;
      return Promise.resolve(jsonResponse(202, { jobId: `job_${String(server.introspects)}` }));
    }
    if (url.startsWith('/api/v1/jobs/job_')) {
      const n = Number(url.split('job_')[1]);
      const end = server.jobEnds[Math.min(n, server.jobEnds.length) - 1] ?? 'succeeded';
      return Promise.resolve(
        jsonResponse(200, {
          data: {
            id: `job_${String(n)}`,
            kind: 'introspect',
            status: end,
            progress: null,
            lastError: end === 'failed' ? 'permission denied for schema app' : null,
          },
        }),
      );
    }
    return Promise.resolve(jsonResponse(200, { data: {} }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderWizard(server: Server): void {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubServer(server);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/desktop/setup'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const newServer = (jobEnds: Server['jobEnds'] = ['succeeded']): Server => ({ probes: [], creates: 0, introspects: 0, jobEnds });

beforeEach(() => {
  setCsrfToken(null);
  window.sessionStorage.clear();
});

afterEach(() => {
  setCsrfToken(null);
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('desktop setup step 4 with a server database (V29)', () => {
  it('stops on a refused login before creating anything, and says why', async () => {
    const server = newServer();
    seedAtGenerate(WRONG);
    renderWizard(server);

    expect(await screen.findByText('Adminium could not connect to that database')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('password authentication failed for user "postgres"');
    expect(alert.textContent, 'the Supabase pooler rule is added to the server hint').toContain(
      'adminium_rw.abcdefghijklmnop',
    );
    expect(server.creates, 'a refused login must not save a connection').toBe(0);
    expect(screen.queryByRole('button', { name: 'Try again' }), 'Try again would be refused the same way').toBeNull();
    expect(screen.getByRole('button', { name: 'Change the connection' })).toBeTruthy();
  });

  it('goes back to step 2 past the account, then straight to step 4 with the new string', async () => {
    const server = newServer();
    seedAtGenerate(WRONG);
    renderWizard(server);

    fireEvent.click(await screen.findByRole('button', { name: 'Change the connection' }));
    expect(await screen.findByText('What should Adminium build from?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' }), 'step 1 is behind the account, a one-way door').toBeNull();

    fireEvent.change(screen.getByDisplayValue(WRONG), { target: { value: RIGHT } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Not the account step again: the account exists.
    expect(screen.queryByText('Create your account')).toBeNull();
    await waitFor(() => {
      expect(server.creates).toBe(1);
    });
    expect(server.probes).toEqual([WRONG, RIGHT]);
    await waitFor(() => {
      expect(screen.queryByText('Adminium could not connect to that database')).toBeNull();
      expect(screen.getByRole('button', { name: 'Generate dashboard' })).toBeTruthy();
    });
  });

  it('waits for the introspect job, shows its failure, and Try again reads again', async () => {
    const server = newServer(['failed', 'succeeded']);
    seedAtGenerate(RIGHT);
    renderWizard(server);

    expect(await screen.findByText('Adminium could not set that database up')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('permission denied for schema app');
    expect(screen.queryByRole('button', { name: 'Generate dashboard' }), 'no Generate over an unread schema').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate dashboard' })).toBeTruthy();
    });
    expect(server.introspects, 'Try again reads the schema again').toBe(2);
    expect(server.creates, 'and never creates a second connection').toBe(1);
  });
});
