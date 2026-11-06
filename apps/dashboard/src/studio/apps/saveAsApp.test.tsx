// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app on `/studio/apps`, router-mounted like the page's own test.
 *
 * What matters:
 *  1. "Save as app" asks which database when there are several, then opens
 *     the quick save filled in; its Save saves and lands on Download, with
 *     the file's name and its fingerprint.
 *  2. The quick save's count is Check's, and "Review choices" opens Check,
 *     where each answer is recorded as its item says.
 *  3. A personal view is answered "stays behind" by default: the plan is
 *     asked again with it, and Save works.
 *  4. "Saved from here" lists the saves; "Save a newer version" opens at
 *     the next version with the last save's name.
 *  5. The wizard's Database step shows workspace chips; unticking a table
 *     other things use asks first.
 *  6. A connection card's "Save as app" lands here with the quick save open.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { AppSaveRow, CheckItem, SaveInventory, SavePlan, SaveRequest } from './saveAppApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const FINGERPRINT = `sha512-${'Ab9+'.repeat(21)}==`;

function connection(id: string, name: string, tableCount: number) {
  return {
    id,
    name,
    engine: 'postgres',
    sourceKind: 'dsn',
    dsnMasked: null,
    readOnly: false,
    status: 'connected',
    lastTestedAt: null,
    lastLatencyMs: null,
    lastError: null,
    lastErrorHint: null,
    snapshot: null,
    timezone: 'UTC',
    timezoneSource: 'operator',
    serverTimezone: 'UTC',
    currency: null,
    disabled: false,
    disabledAt: null,
    tableCount,
    pageCount: 2,
    createdAt: 1,
    updatedAt: 1,
  };
}

function inventory(connectionId = 'con_f', withViews = false): SaveInventory {
  return {
    connectionId,
    tables: [
      { id: 'public.customers', name: 'customers', columns: 14, rows: 1240, rowsExact: true, links: [], personal: ['email', 'phone'], secretLike: [], rowsAllowed: true, personalAllowed: true },
      { id: 'public.orders', name: 'orders', columns: 12, rows: 80, rowsExact: true, links: [{ column: 'customer_id', to: 'public.customers', required: false }], personal: [], secretLike: [], rowsAllowed: false, personalAllowed: false },
    ],
    pages: [
      { id: 'page_customers', title: 'Customers', tableId: 'public.customers', generated: true },
      { id: 'page_orders', title: 'Orders', tableId: 'public.orders', generated: false },
    ],
    views: withViews ? [{ id: 'view_mine', name: 'Late ones', pageId: 'page_orders', ownerId: 'usr_rosa', ownerName: 'Rosa Okafor' }] : [],
    roles: [],
    automations: [{ id: 'aut_1', name: 'Welcome new wholesale customers', tableIds: ['public.customers'] }],
    emailTemplates: [],
    documents: [],
    reports: [],
    invoiceLayouts: [],
    scheduledReports: [],
    publicEndpoints: [],
    payments: false,
    instance: true,
  };
}

const VIEW_ITEM: CheckItem = {
  group: 'choice',
  code: 'PERSONAL_VIEW',
  kind: 'view',
  item: 'Orders: Late ones',
  message: 'x',
  answer: { choices: ['make-shared', 'leave-out'], target: 'view_mine', targets: { 'leave-out': 'view:view_mine' } },
};
const SECRET_ITEM: CheckItem = {
  group: 'choice',
  code: 'SECRET_FOUND',
  kind: 'automation',
  item: 'Post wholesale orders to Slack',
  field: 'steps[0].body',
  message: 'x',
  answer: { choices: ['clear', 'leave-out'], target: 'automation:Post wholesale orders to Slack:steps[0].body', targets: { 'leave-out': 'automation:Post wholesale orders to Slack' } },
};
const TYPE_ITEM: CheckItem = {
  group: 'choice',
  code: 'TYPE_NO_FORM',
  kind: 'column',
  item: 'activity_log',
  field: 'ip_address',
  message: 'x',
  answer: { choices: ['carry-as-text', 'leave-out'], target: 'public.activity_log.ip_address' },
};

/** The plan the server would give for a request: the items not yet answered. */
type Planner = (request: SaveRequest) => Partial<SavePlan> & { check: CheckItem[] };

const answeredBy = (request: SaveRequest) => [...(request.answers?.leaveOut ?? []), ...(request.answers?.clear ?? []), ...(request.answers?.carryAsText ?? []), ...(request.answers?.shareViews ?? [])];
const openOf = (items: CheckItem[]): Planner => (request) => {
  const done = new Set(answeredBy(request));
  const check = items.filter((item) => item.answer === undefined || ![item.answer.target, ...Object.values(item.answer.targets ?? {})].some((value) => done.has(value)));
  return { check, ready: check.every((item) => item.group !== 'choice') };
};

interface StubOptions {
  connections?: ReturnType<typeof connection>[];
  saves?: AppSaveRow[];
  planner?: Planner;
  workspaces?: unknown;
  /** A person's own view on the orders page. */
  views?: boolean;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const planner = options.planner ?? (() => ({ check: [{ group: 'info' as const, code: 'MIN_VERSION', kind: 'app', item: 'x', message: 'x' }], ready: true }));
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: { ...makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }), ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }) } }));
      }
      if (url === '/api/v1/surfaces') return Promise.resolve(jsonResponse(200, { instances: {}, surfaces: [], domains: {} }));
      if (url === '/api/v1/apps/catalog') return Promise.resolve(jsonResponse(200, { apps: [], catalogFetchedAt: null, onlineEnabled: false }));
      if (url === '/api/v1/apps' && method === 'GET') return Promise.resolve(jsonResponse(200, { apps: [], staged: [] }));
      if (url === '/api/v1/connections') return Promise.resolve(jsonResponse(200, { connections: options.connections ?? [connection('con_f', 'fernhill', 30), connection('con_a', 'fernhill_archive', 12)] }));
      if (url === '/api/v1/apps/saves') return Promise.resolve(jsonResponse(200, { saves: options.saves ?? [] }));
      if (url.startsWith('/api/v1/apps/save/inventory')) {
        const id = new URL(url, 'http://x').searchParams.get('connectionId') ?? '';
        return Promise.resolve(jsonResponse(200, { inventory: inventory(id, options.views === true) }));
      }
      if (url === '/api/v1/apps/save/plan') {
        const request = body as SaveRequest;
        const planned = planner(request);
        return Promise.resolve(
          jsonResponse(200, {
            plan: { key: request.key, version: request.version ?? '1.0.0', lineage: 'new', label: 'Fernhill main', minAdminiumVersion: '0.3.49', ready: true, problems: [], counts: { tables: 2, pages: 2, roles: 0, automations: 1, emailTemplates: 0 }, ...planned },
          }),
        );
      }
      if (url === '/api/v1/apps/save' && method === 'POST') {
        const request = body as SaveRequest;
        const version = request.version ?? '1.0.0';
        return Promise.resolve(jsonResponse(200, { save: { id: 'asv_new', key: request.key, version, integrity: FINGERPRINT, bytes: 188_416, filename: `${request.key}-${version}.tgz`, savedAt: 1 } }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }));
    }),
  );
  return calls;
}

function renderAt(path: string, options: StubOptions = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stubFetch(options);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return calls;
}

const plans = (calls: { url: string; body?: unknown }[]) => calls.filter((call) => call.url === '/api/v1/apps/save/plan').map((call) => call.body as SaveRequest);

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

describe('Save as app', () => {
  it('asks which database, quick-saves everything without rows, and lands on Download with the fingerprint', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/studio/apps');
    await user.click((await screen.findAllByRole('button', { name: 'Save as app' }))[0]!);
    expect(await screen.findByText('Save which database?')).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: /fernhill_archive/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Save fernhill_archive as an app' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('fernhill_archive');
    expect((within(dialog).getByLabelText('Key') as HTMLInputElement).value).toBe('fernhill-archive');
    expect((within(dialog).getByLabelText('Version') as HTMLInputElement).value).toBe('1.0.0');
    expect(await within(dialog).findByText('Ready to save')).toBeTruthy();
    expect(within(dialog).getByText(/2 tables, 2 pages, 0 roles, 1 automation and 0 more things/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('fernhill-archive-1.0.0.tgz')).toBeTruthy();
    expect(screen.getByText(/is saved as a file/)).toBeTruthy();
    expect(screen.getByText(FINGERPRINT.slice(0, Math.ceil(FINGERPRINT.length / 2)))).toBeTruthy();
    const saved = calls.find((call) => call.url === '/api/v1/apps/save')!.body as SaveRequest;
    expect(saved).toMatchObject({ connectionId: 'con_a', key: 'fernhill-archive', name: 'fernhill_archive', include: { tables: ['public.customers', 'public.orders'], instance: false } });
    expect(saved.rows).toBeUndefined();
    expect(saved.version).toBeUndefined();
  });

  it('counts what Check counts, and records each answer in Check as its item says', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/studio/apps', { connections: [connection('con_f', 'fernhill', 30)], planner: openOf([SECRET_ITEM, TYPE_ITEM]) });
    await user.click((await screen.findAllByRole('button', { name: 'Save as app' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Save fernhill as an app' });
    expect(await within(dialog).findByText('2 things need a choice')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Review choices' }));

    expect(await screen.findByRole('heading', { name: 'Check' })).toBeTruthy();
    const pills = screen.getByText((_, node) => node?.getAttribute('data-part') === 'check-pills');
    expect(within(pills).getByText('Blocks saving').textContent).toBe('Blocks saving1');
    expect(within(pills).getByText('Needs a choice').textContent).toBe('Needs a choice1');
    expect(screen.getByText(/holds a saved secret of this server/)).toBeTruthy();
    expect(screen.getByText('Clear or leave out the saved secret to save.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    const secretRow = screen.getByText(/holds a saved secret/).closest('div')!.parentElement!;
    await user.click(within(secretRow).getByRole('button', { name: 'Leave it out' }));
    await user.click(screen.getByRole('button', { name: 'Carry as text' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    expect(plans(calls).at(-1)?.answers).toEqual({ leaveOut: ['automation:Post wholesale orders to Slack'], carryAsText: ['public.activity_log.ip_address'] });
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2);
    // Focus moved to the answered item's Undo.
    expect(document.activeElement?.textContent).toBe('Undo');
  });

  it('answers a personal view "stays behind" by default, counts it once, and saves', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/studio/apps', { connections: [connection('con_f', 'fernhill', 30)], planner: openOf([VIEW_ITEM]), views: true });
    await user.click((await screen.findAllByRole('button', { name: 'Save as app' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Save fernhill as an app' });
    expect(await within(dialog).findByText('1 thing needs a choice')).toBeTruthy();
    expect(within(dialog).getByText('1 saved view belongs to a person')).toBeTruthy();
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    expect(plans(calls).at(-1)?.answers).toEqual({ leaveOut: ['view:view_mine'] });
    await user.click(within(dialog).getByRole('button', { name: /Show them/ }));
    expect(within(dialog).getByText('0 of 1')).toBeTruthy();
  });

  it('lists the saves made here and opens a newer version at the next number', async () => {
    const user = userEvent.setup();
    const save: AppSaveRow = { id: 'asv_1', key: 'fernhill-ops', version: '1.1.0', connectionId: 'con_f', name: 'Fernhill Ops', description: 'Roasting', icon: 'coffee', label: 'Fernhill main', savedBy: 'usr_rosa', savedByName: 'Rosa Okafor', savedAt: Date.UTC(2026, 10, 1), integrity: FINGERPRINT, bytes: 10, downloadable: true };
    const calls = renderAt('/studio/apps', { saves: [save] });
    const card = (await screen.findByText('Saved from here')).closest('[data-part="saved-from-here"]') as HTMLElement;
    expect(within(card).getByText('Fernhill Ops')).toBeTruthy();
    expect(within(card).getByText('1.1.0')).toBeTruthy();
    expect(within(card).getByText(/by Rosa Okafor/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Download again' })).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Save a newer version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save fernhill as an app' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Fernhill Ops');
    expect((within(dialog).getByLabelText('Version') as HTMLInputElement).value).toBe('1.1.1');
    await within(dialog).findByText('Ready to save');
    expect(plans(calls).at(-1)).toMatchObject({ key: 'fernhill-ops', description: 'Roasting', icon: 'coffee', label: 'Fernhill main' });
  });

  it('shows workspace chips on the Database step, asks before unticking a table others use, and takes an icon', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/studio/apps', {
      workspaces: {
        workspaces: [{ id: 'ws_f', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: ['con_f'] }],
        otherDatabases: ['con_a'],
        workspaceView: 'one',
        lastWorkspaceId: 'ws_f',
        manage: true,
      },
    });
    await user.click((await screen.findAllByRole('button', { name: 'Save as app' }))[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /^fernhill\s*Postgres/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Save fernhill as an app' });
    await user.click(within(dialog).getByRole('button', { name: 'More choices' }));

    // The wizard opens on What to include; the Database step is one back.
    expect(await screen.findByRole('heading', { name: 'What to include' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
    const chips = screen.getAllByText((_, node) => node?.getAttribute('data-part') === 'workspace-chips').map((node) => node.textContent);
    expect(chips).toEqual(['Fernhill Coffee', 'Other databases']);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.click(await screen.findByRole('button', { name: /Tables/ }));
    await user.click(screen.getByRole('checkbox', { name: 'customers' }));
    const ask = await screen.findByRole('dialog', { name: 'Other things use customers' });
    expect(within(ask).getByText('Welcome new wholesale customers')).toBeTruthy();
    expect(within(ask).getByText('orders.customer_id')).toBeTruthy();
    await user.click(within(ask).getByRole('button', { name: 'Keep the columns, drop the links' }));
    expect((screen.getByRole('checkbox', { name: 'customers' }) as HTMLButtonElement).getAttribute('data-state')).toBe('unchecked');
    expect((screen.getByRole('checkbox', { name: 'orders' }) as HTMLButtonElement).getAttribute('data-state')).toBe('checked');
    // A table the saver may not read whole keeps its rows at Nothing.
    expect(screen.getByText(/You can’t read orders/)).toBeTruthy();

    // About the app: the icon is chosen from the twelve, and the plan carries it.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'About the app' })).toBeTruthy();
    const icons = screen.getByRole('radiogroup', { name: 'Icon' });
    expect(within(icons).getAllByRole('radio')).toHaveLength(12);
    await user.click(within(icons).getByRole('radio', { name: 'Coffee' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Check' })).toBeTruthy();
    await waitFor(() => expect(plans(calls).at(-1)?.icon).toBe('coffee'));
  });

  it('opens the quick save on the database a connection card named', async () => {
    renderAt('/studio/apps?save=con_a');
    expect(await screen.findByRole('dialog', { name: 'Save fernhill_archive as an app' })).toBeTruthy();
  });
});
