// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connections hub component tests (M5-T05): card rendering (engine badge,
 * health pill, counts, relative snapshot age), the header/empty CTAs, the
 * per-card test + re-introspect actions with their toast feedback (noop vs
 * diff), and the type-to-confirm delete gating with the DELETE payload.
 * Fetch mocked like the sibling remap/connect suites (no msw).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import { ConnectionsHub } from './ConnectionsHub.js';
import { ShellHarness } from '../../test/shellHarness.js';

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

const DAY = 86_400_000;

function makeConnection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 'conn_1',
    name: 'Production Postgres',
    engine: 'postgres',
    sourceKind: 'dsn',
    dsnMasked: 'postgres://ava@db.acme.io:5432/prod',
    readOnly: true,
    status: 'connected',
    lastTestedAt: Date.now() - 60_000,
    lastLatencyMs: 42,
    lastError: null,
    lastErrorHint: null,
    snapshot: { id: 'snap_1', createdAt: Date.now() - 2 * DAY, checksum: 'abc' },
    tableCount: 14,
    pageCount: 9,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function installFetch(
  connections: () => ConnectionDto[],
  overrides: Partial<Record<string, (call: Call) => Response>> = {},
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const call: Call = {
      method,
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const key = `${method} ${url}`;
    const override = overrides[key];
    if (override !== undefined) return Promise.resolve(override(call));
    if (key === 'GET /api/v1/connections') {
      return Promise.resolve(jsonResponse(200, { connections: connections() }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${key}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function renderHub(props: Partial<Parameters<typeof ConnectionsHub>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <ShellHarness>
        <ConnectionsHub
          onConnectNew={props.onConnectNew ?? (() => undefined)}
          onOpenRemap={props.onOpenRemap ?? (() => undefined)}
          pollIntervalMs={0}
        />
        </ShellHarness>
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

describe('ConnectionsHub', () => {
  it('renders health cards: engine badge, status, counts, masked DSN, snapshot age', async () => {
    installFetch(() => [
      makeConnection(),
      makeConnection({
        id: 'conn_2',
        name: 'Analytics MySQL',
        engine: 'mysql',
        status: 'error',
        lastError: 'access denied for role reporting',
        readOnly: false,
        snapshot: null,
        tableCount: null,
        pageCount: 0,
      }),
    ]);
    renderHub();

    const first = within(await screen.findByTestId('connection-card-conn_1'));
    expect(first.getByText('Production Postgres')).toBeTruthy();
    expect(first.getByText('PostgreSQL')).toBeTruthy();
    expect(first.getByText('Connected')).toBeTruthy();
    expect(first.getByText('Read-only')).toBeTruthy();
    expect(first.getByText('postgres://ava@db.acme.io:5432/prod')).toBeTruthy();
    expect(first.getByText('14')).toBeTruthy(); // tables
    expect(first.getByText('9')).toBeTruthy(); // pages
    expect(first.getByText('42 ms')).toBeTruthy(); // latency
    expect(first.getByText('2 days ago')).toBeTruthy(); // Intl relative

    const second = within(screen.getByTestId('connection-card-conn_2'));
    expect(second.getByText('MySQL / MariaDB')).toBeTruthy();
    expect(second.getByText('Error')).toBeTruthy();
    expect(second.getByRole('alert').textContent).toContain('access denied for role reporting');
    expect(second.getByText('Never')).toBeTruthy();

    // Stat tiles aggregate the fleet.
    expect(screen.getByText('1 of 2 connections healthy')).toBeTruthy();
    expect(screen.getByText('Generated pages')).toBeTruthy();
  });

  it('shows the persisted remediation hint under the driver message', async () => {
    // The hint survives a reload: without it the card would show only the bare
    // SQLSTATE, which is exactly the dead end a pooled DSN used to hit.
    installFetch(() => [
      makeConnection({
        id: 'conn_3',
        name: 'Neon',
        status: 'error',
        lastError: '08P01: unsupported startup parameter in options: statement_timeout',
        lastErrorHint: 'use the direct/unpooled connection string — on Neon drop `-pooler` from the host',
      }),
    ]);
    renderHub();

    const card = within(await screen.findByTestId('connection-card-conn_3'));
    const alert = card.getByRole('alert').textContent ?? '';
    expect(alert).toContain('unsupported startup parameter');
    expect(alert).toContain('drop `-pooler` from the host');
  });

  it('empty state offers the connect CTA; header button always does', async () => {
    installFetch(() => []);
    const onConnectNew = vi.fn();
    renderHub({ onConnectNew });

    await screen.findByText('No data sources yet');
    await userEvent.click(screen.getByRole('button', { name: 'Connect a database' }));
    await userEvent.click(screen.getByRole('button', { name: /New connection/ }));
    expect(onConnectNew).toHaveBeenCalledTimes(2);
  });

  it('remap action navigates with the connection id', async () => {
    installFetch(() => [makeConnection()]);
    const onOpenRemap = vi.fn();
    renderHub({ onOpenRemap });

    await userEvent.click(await screen.findByRole('button', { name: 'Remap schema' }));
    expect(onOpenRemap).toHaveBeenCalledWith('conn_1');
  });

  it('test action hits the per-connection endpoint and toasts the health result', async () => {
    const { calls } = installFetch(() => [makeConnection()], {
      'POST /api/v1/connections/conn_1/test': () =>
        jsonResponse(200, {
          ok: true,
          latencyMs: 37,
          serverVersion: '16.4',
          readOnly: true,
          privileges: null,
          error: null,
        }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Test' }));
    await screen.findByText('Connection healthy · 37 ms');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/connections/conn_1/test'))).toBe(true);
    // Health refresh: the list is refetched after the test settles.
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'GET' && c.url.endsWith('/api/v1/connections')).length).toBeGreaterThan(1);
    });
  });

  it('re-introspect reports the no-op diff', async () => {
    installFetch(() => [makeConnection()], {
      'POST /api/v1/connections/conn_1/introspect': () =>
        jsonResponse(200, { snapshotId: 'snap_1', noop: true, proposedMasks: 0, checksum: 'abc' }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Re-introspect' }));
    await screen.findByText('Schema unchanged — no new snapshot.');
  });

  it('re-introspect reports a new snapshot with proposed masks', async () => {
    installFetch(() => [makeConnection()], {
      'POST /api/v1/connections/conn_1/introspect': () =>
        jsonResponse(200, { snapshotId: 'snap_2', noop: false, proposedMasks: 3, checksum: 'def' }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Re-introspect' }));
    await screen.findByText('Schema re-introspected');
    await screen.findByText('3 columns proposed for masking — review in the remap editor.');
  });

  it('re-introspect polls the 202 job to completion', async () => {
    let jobPolls = 0;
    installFetch(() => [makeConnection()], {
      'POST /api/v1/connections/conn_1/introspect': () => jsonResponse(202, { jobId: 'job_9' }),
      'GET /api/v1/jobs/job_9': () => {
        jobPolls += 1;
        return jsonResponse(200, {
          data: {
            id: 'job_9',
            kind: 'introspect',
            status: jobPolls < 2 ? 'running' : 'succeeded',
            progress: null,
            lastError: null,
          },
        });
      },
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Re-introspect' }));
    await screen.findByText('Schema re-introspected');
    expect(jobPolls).toBeGreaterThanOrEqual(2);
  });

  /**
   * The poll used to outlive the card that started it: `awaitIntrospectJob` runs
   * up to 100 iterations, so leaving the hub mid-introspection kept fetching
   * `/jobs/:id` for as much as two minutes and ended in a toast about a screen
   * the user had left. It now takes an `AbortSignal` the card aborts on unmount.
   *
   * `pollIntervalMs` is 0 here (see `renderHub`), so the loop is only ever one
   * microtask from its next fetch — which is the honest way to test this: if the
   * abort did not land, the count would keep climbing while the assertion waits.
   */
  it('stops polling the introspect job when the hub unmounts, and says nothing', async () => {
    let jobPolls = 0;
    installFetch(() => [makeConnection()], {
      'POST /api/v1/connections/conn_1/introspect': () => jsonResponse(202, { jobId: 'job_9' }),
      'GET /api/v1/jobs/job_9': () => {
        jobPolls += 1;
        // Never terminal: only the abort can end this loop.
        return jsonResponse(200, {
          data: { id: 'job_9', kind: 'introspect', status: 'running', progress: null, lastError: null },
        });
      },
    });
    const { unmount } = renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Re-introspect' }));
    await waitFor(() => {
      expect(jobPolls).toBeGreaterThanOrEqual(1);
    });

    unmount();
    const atUnmount = jobPolls;
    await new Promise((resolve) => setTimeout(resolve, 60));

    // At most the one request already in flight when the abort landed.
    expect(jobPolls).toBeLessThanOrEqual(atUnmount + 1);
    // And no toast claiming an outcome — least of all a failure, which is what
    // the old exhausted-loop path would eventually have reported.
    expect(screen.queryByText('Introspection failed. Try again.')).toBeNull();
    expect(screen.queryByText('Schema re-introspected')).toBeNull();
  });

  it('delete is gated on typing the exact connection name and sends confirmName', async () => {
    const { calls } = installFetch(() => [makeConnection()], {
      'DELETE /api/v1/connections/conn_1': () => jsonResponse(200, { ok: true }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete connection' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    const input = within(dialog).getByRole('textbox');
    await userEvent.type(input, 'production postgres'); // wrong case — still locked
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(input);
    await userEvent.type(input, 'Production Postgres');
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(confirmButton);
    await screen.findByText('Connection “Production Postgres” deleted');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toContain('/api/v1/connections/conn_1');
    expect(del?.body).toEqual({ confirmName: 'Production Postgres' });
  });

  it('surfaces a delete failure as an error toast and keeps the card', async () => {
    installFetch(() => [makeConnection()], {
      'DELETE /api/v1/connections/conn_1': () =>
        jsonResponse(409, {
          error: { code: 'CONFLICT', message: 'Type the connection name to confirm deletion.' },
        }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Production Postgres');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete connection' }));

    await screen.findByText('Could not delete the connection. Try again.');
    expect(screen.getByTestId('connection-card-conn_1')).toBeTruthy();
  });
});
