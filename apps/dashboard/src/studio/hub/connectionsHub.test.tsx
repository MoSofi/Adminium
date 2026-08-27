// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connections hub component tests (M5-T05): card rendering (engine badge,
 * health pill, counts, relative snapshot age), the header/empty CTAs, the
 * per-card test + re-introspect actions with their toast feedback (noop vs
 * diff), the pause/resume flow (meta wave 0019), and the type-to-confirm
 * delete gating with the DELETE payload.
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
    timezone: null,
    timezoneSource: null,
    currency: null,
    disabled: false,
    disabledAt: null,
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
  // The client is returned so a test can watch which caches an action
  // invalidates — the rename has to refresh `bootstrap` as well as its own.
  const rendered = render(
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
  return { ...rendered, queryClient };
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

  it('marks a server-guessed zone on the card and says so in the modal', async () => {
    /*
     * The point of the provenance flag (meta wave 0018): a zone nobody chose
     * must not render identically to one an operator did. Both surfaces are
     * asserted together because either alone leaves the guess passing for a
     * decision somewhere.
     */
    installFetch(() => [
      makeConnection({ timezone: 'Europe/Berlin', timezoneSource: 'host' }),
    ]);
    renderHub();

    expect(await screen.findByText('from this server')).toBeTruthy();

    await userEvent.click(await screen.findByRole('button', { name: 'Regional settings' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('This zone came from the server')).toBeTruthy();
  });

  it('says nothing about provenance for a zone the operator set', async () => {
    installFetch(() => [
      makeConnection({ timezone: 'Europe/Berlin', timezoneSource: 'operator' }),
    ]);
    renderHub();

    expect(await screen.findByText('Europe/Berlin')).toBeTruthy();
    expect(screen.queryByText('from this server')).toBeNull();

    await userEvent.click(await screen.findByRole('button', { name: 'Regional settings' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('This zone came from the server')).toBeNull();
  });

  it('saving a guessed zone unchanged confirms it, retiring the guess', async () => {
    /*
     * Without this, a guess that happens to be RIGHT could never be dismissed:
     * the operator would have to change the zone to something else and back to
     * make the badge go away, and most would simply learn to ignore it.
     */
    const { calls } = installFetch(
      () => [makeConnection({ timezone: 'Europe/Berlin', timezoneSource: 'host' })],
      {
        'PATCH /api/v1/connections/conn_1': () =>
          jsonResponse(200, { id: 'conn_1', timezone: 'Europe/Berlin', timezoneSource: 'operator' }),
      },
    );
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Regional settings' }));
    const dialog = await screen.findByRole('dialog');

    const save = within(dialog).getByTestId('regional-save');
    // Enabled with nothing edited — confirming IS the edit.
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(save);

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    // The unchanged value is sent on purpose: the write is what relabels it.
    expect(patch?.body).toEqual({ timezone: 'Europe/Berlin' });
  });

  it('renames a connection and refreshes BOTH caches', async () => {
    /*
     * The card reads the connections query; the sidebar group over this
     * connection's generated pages reads `bootstrap`. Refreshing only the first
     * renames the card and leaves the rail saying the old name, which reads as
     * the rename having silently failed — so both invalidations are asserted,
     * not just the PATCH.
     */
    const { calls } = installFetch(() => [makeConnection()], {
      'PATCH /api/v1/connections/conn_1': () =>
        jsonResponse(200, { ...makeConnection(), name: 'Northwind' }),
    });
    const { queryClient } = renderHub();
    const invalidated: unknown[] = [];
    const spy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation((filters?: { queryKey?: unknown }) => {
        invalidated.push(filters?.queryKey);
        return Promise.resolve();
      });

    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByTestId('rename-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Northwind');
    await userEvent.click(within(dialog).getByTestId('rename-save'));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Northwind' });
    await waitFor(() => {
      expect(JSON.stringify(invalidated)).toContain('bootstrap');
    });
    expect(JSON.stringify(invalidated)).toContain('connections');
    spy.mockRestore();
  });

  it('will not save a name that is unchanged or blank', async () => {
    // Both are round trips that store what the server would hand straight back,
    // and a blank one the server would refuse — so the button stays shut.
    installFetch(() => [makeConnection()]);
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByTestId('rename-save');
    // Prefilled with the current name: nothing to do yet.
    expect((save as HTMLButtonElement).disabled).toBe(true);

    const input = within(dialog).getByTestId('rename-input');
    await userEvent.clear(input);
    expect((save as HTMLButtonElement).disabled).toBe(true);

    // Whitespace-only is blank once trimmed, not a rename.
    await userEvent.type(input, '   ');
    expect((save as HTMLButtonElement).disabled).toBe(true);
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

  /*
   * Regional settings (28-T34). These exist because the server has carried
   * `timezone` since migration 0015 and a hosted app surface refuses to boot
   * without it, while nothing rendered the field — so the only proof the UI
   * really writes it is the PATCH body asserted below.
   */
  it('shows the connection timezone on the card, and an em dash when unset', async () => {
    installFetch(() => [
      makeConnection({ timezone: 'Europe/London' }),
      makeConnection({ id: 'conn_2', name: 'Analytics', timezone: null }),
    ]);
    renderHub();

    const withZone = await screen.findByTestId('connection-card-conn_1');
    expect(within(withZone).getByText('Europe/London')).toBeTruthy();

    const withoutZone = screen.getByTestId('connection-card-conn_2');
    const cell = within(withoutZone).getByText('Timezone').parentElement;
    expect(cell?.textContent).toContain('\u2014');
  });

  it('saves a chosen timezone and sends ONLY the field that changed', async () => {
    const { calls } = installFetch(() => [makeConnection({ timezone: null, currency: 'GBP' })], {
      'PATCH /api/v1/connections/conn_1': () => jsonResponse(200, { id: 'conn_1' }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Regional settings' }));
    const dialog = await screen.findByRole('dialog');

    const save = within(dialog).getByRole('button', { name: 'Save' });
    // Nothing edited yet — an unchanged submit would PATCH an empty object.
    expect((save as HTMLButtonElement).disabled).toBe(true);

    const zone = within(dialog).getByLabelText('Timezone');
    await userEvent.click(zone);
    await userEvent.type(zone, 'Europe/Lond');
    await userEvent.click(await screen.findByRole('option', { name: /Europe\/London/ }));

    expect((save as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(save);

    await screen.findByText('Regional settings updated');
    const patch = calls.find((c) => c.method === 'PATCH');
    // `currency` is absent, not null: it did not change, and the server reads
    // an omitted field as "leave it alone" but an explicit null as "clear it".
    expect(patch?.body).toEqual({ timezone: 'Europe/London' });
  });

  it('clears a timezone through the "Not set" row, as an explicit null', async () => {
    const { calls } = installFetch(() => [makeConnection({ timezone: 'Europe/London' })], {
      'PATCH /api/v1/connections/conn_1': () => jsonResponse(200, { id: 'conn_1' }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: 'Regional settings' }));
    const dialog = await screen.findByRole('dialog');

    const zone = within(dialog).getByLabelText('Timezone');
    await userEvent.click(zone);
    await userEvent.type(zone, 'Not set');
    await userEvent.click(await screen.findByRole('option', { name: 'Not set' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await screen.findByText('Regional settings updated');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ timezone: null });
  });

  // --- pause / resume (meta wave 0019) ---------------------------------------

  it('pausing asks first, then PATCHes only `disabled`', async () => {
    const { calls } = installFetch(() => [makeConnection()], {
      'PATCH /api/v1/connections/conn_1': () =>
        jsonResponse(200, { id: 'conn_1', name: 'Production Postgres', disabled: true }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: /Pause/ }));
    const dialog = await screen.findByRole('dialog');
    // The consequences are not visible from the button: the pages, reports and
    // hosted apps that stop are all on other screens.
    expect(within(dialog).getByText(/9 pages, scheduled reports and hosted apps/)).toBeTruthy();
    // …and the reassurance that makes this the alternative to Delete.
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeTruthy();
    // NOT type-to-confirm: that friction belongs to the irreversible action.
    expect(within(dialog).queryByRole('textbox')).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause connection' }));

    await screen.findByText('Connection “Production Postgres” paused');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ disabled: true });
  });

  it('cancelling the dialog changes nothing', async () => {
    const { calls } = installFetch(() => [makeConnection()]);
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: /Pause/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('a paused card says so, keeps the failing health reading, and drops out of "healthy"', async () => {
    installFetch(() => [
      makeConnection({
        disabled: true,
        disabledAt: Date.now() - 3 * DAY,
        // It was FAILING when it was paused — the pill outranks that, the card
        // still reports it.
        status: 'error',
        lastError: 'access denied for role reporting',
      }),
    ]);
    renderHub();

    const card = within(await screen.findByTestId('connection-card-conn_1'));
    expect(card.getByText('Paused')).toBeTruthy();
    expect(card.getByText(/Paused 3 days ago/)).toBeTruthy();
    expect(card.getByText('access denied for role reporting')).toBeTruthy();
    // A paused source is serving nothing, so it cannot be counted healthy —
    // and the header says how many are paused, but only when some are.
    expect(screen.getByText(/0 of 1 connection healthy · 1 paused/)).toBeTruthy();
  });

  it('takes away the two actions that dial the source, and says why', async () => {
    installFetch(() => [makeConnection({ disabled: true, disabledAt: Date.now() })]);
    renderHub();

    const card = within(await screen.findByTestId('connection-card-conn_1'));
    expect((card.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true);
    expect((card.getByRole('button', { name: /Re-introspect/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // Meta-only editors stay open: a pause is for the database, not for the
    // mapping work that never touches it.
    expect((card.getByRole('button', { name: 'Remap schema' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (card.getByRole('button', { name: 'Regional settings' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('resumes immediately, with no dialog', async () => {
    const { calls } = installFetch(() => [makeConnection({ disabled: true, disabledAt: Date.now() })], {
      'PATCH /api/v1/connections/conn_1': () =>
        jsonResponse(200, { id: 'conn_1', name: 'Production Postgres', disabled: false }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: /Resume/ }));

    await screen.findByText('Connection “Production Postgres” resumed');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ disabled: false });
  });

  it('surfaces a failed pause as an error toast and leaves the card serving', async () => {
    installFetch(() => [makeConnection()], {
      'PATCH /api/v1/connections/conn_1': () =>
        jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } }),
    });
    renderHub();

    await userEvent.click(await screen.findByRole('button', { name: /Pause/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Pause connection' }),
    );

    await screen.findByText('Could not pause the connection. Try again.');
    const card = within(screen.getByTestId('connection-card-conn_1'));
    expect(card.getByText('Connected')).toBeTruthy();
  });
});
