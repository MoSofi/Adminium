// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Workspaces card's rows, with what other screens put on them:
 *
 *  - Save workspace and Sender on each workspace's row;
 *  - Delete lists what the workspace alone shows ("Shown in"), from the
 *    delete plan;
 *  - Save workspace's "More choices" opens Save as app's wizard on that
 *    database, over the dialog, and its choices come back to the dialog's
 *    next plan.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import type { SaveRequest } from '../apps/saveAppApi.js';
import { WorkspacesCard, workspaceAppOf } from './WorkspacesCard.js';
import type { WorkspaceList } from './workspacesApi.js';

const CONNECTIONS = [
  { id: 'c-fernhill', name: 'fernhill', engine: 'postgres', readOnly: false, tableCount: 2 },
  { id: 'c-kiln', name: 'kiln', engine: 'postgres', readOnly: false, tableCount: 2 },
] as unknown as ConnectionDto[];

const NO_SENDER = { name: null, from: null, replyTo: null, postal: null };
const LIST: WorkspaceList = {
  workspaces: [
    { id: 'wsp-fc', name: 'Fernhill Coffee', position: 0, connectionIds: ['c-fernhill'], sender: NO_SENDER, createdAt: 0, updatedAt: 0 },
    { id: 'wsp-ks', name: 'Kiln Street Pottery', position: 1, connectionIds: ['c-kiln'], sender: NO_SENDER, createdAt: 0, updatedAt: 0 },
  ],
  otherDatabases: [],
  view: 'one',
};

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

let calls: Call[];

function inventory(connectionId: string) {
  return {
    connectionId,
    tables: [{ id: 'public.orders', name: 'orders', columns: 4, rows: 8, rowsExact: true, links: [], personal: [], secretLike: [], rowsAllowed: true, personalAllowed: true }],
    pages: [{ id: 'page_orders', title: 'Orders', tableId: 'public.orders', generated: true }],
    views: [],
    roles: [],
    automations: [],
    emailTemplates: [],
    documents: [],
    reports: [],
    invoiceLayouts: [],
    scheduledReports: [],
    publicEndpoints: [],
    payments: false,
    instance: false,
  };
}

function workspacePlan() {
  return {
    plan: {
      workspaceId: 'wsp-fc',
      name: 'Fernhill Coffee',
      label: 'Fernhill main',
      filename: 'fernhill-coffee.workspace.tgz',
      minAdminiumVersion: '0.3.49',
      ready: true,
      instanceFrom: null,
      workspaces: ['Fernhill Coffee'],
      apps: [
        {
          connectionId: 'c-fernhill',
          database: { name: 'fernhill', engine: 'postgres' },
          key: 'fernhill-ops',
          name: 'Fernhill Ops',
          lastSaved: null,
          plan: { key: 'fernhill-ops', version: '1.0.0', lineage: 'new', label: 'Fernhill main', minAdminiumVersion: '0.3.49', ready: true, check: [], problems: [], counts: {} },
        },
      ],
    },
  };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url === '/api/v1/workspaces/sender-domains') return Promise.resolve(jsonResponse(200, { domains: ['fernhill.example'], addresses: [] }));
      if (url === '/api/v1/workspaces/wsp-ks/delete-plan') {
        return Promise.resolve(
          jsonResponse(200, {
            workspace: LIST.workspaces[1],
            connectionIds: ['c-kiln'],
            shownOnlyIn: [
              { kind: 'email-template', itemId: 'et_1', name: 'Firing done' },
              { kind: 'invoice', itemId: 'inv_1', name: 'Wholesale' },
            ],
            last: false,
          }),
        );
      }
      if (url === '/api/v1/workspaces/wsp-fc/save/plan') return Promise.resolve(jsonResponse(200, workspacePlan()));
      if (url === '/api/v1/connections') return Promise.resolve(jsonResponse(200, { connections: CONNECTIONS }));
      if (url === '/api/v1/apps/saves') return Promise.resolve(jsonResponse(200, { saves: [], workspaces: [] }));
      if (url === '/api/v1/apps/catalog') return Promise.resolve(jsonResponse(200, { apps: [], catalogFetchedAt: null, onlineEnabled: false }));
      if (url.startsWith('/api/v1/apps/save/inventory')) {
        const id = new URL(url, 'http://x').searchParams.get('connectionId') ?? '';
        return Promise.resolve(jsonResponse(200, { inventory: inventory(id) }));
      }
      if (url === '/api/v1/apps/save/plan') {
        const request = body as SaveRequest;
        return Promise.resolve(
          jsonResponse(200, { plan: { key: request.key, version: request.version ?? '1.0.0', lineage: 'new', label: 'Fernhill main', minAdminiumVersion: '0.3.49', ready: true, problems: [], check: [], counts: { tables: 1, pages: 1 } } }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no ${method} ${url}`, requestId: 'r' } }));
    }),
  );
}

function mount(actions: string[] = ['manifests.manage', 'connections.manage']): QueryClient {
  const client = createQueryClient();
  client.setQueryData(['bootstrap'], makeBootstrap({ systemActions: actions as never }));
  render(
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <WorkspacesCard list={LIST} connections={CONNECTIONS} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  calls = [];
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a workspace row', () => {
  it('has Save workspace and Sender; Sender opens that workspace’s sender', async () => {
    const user = userEvent.setup();
    mount();
    const row = screen.getByTestId('workspace-row-wsp-ks');
    expect(within(row).getByRole('button', { name: 'Save workspace' })).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: 'Sender' }));
    expect(await screen.findByRole('dialog', { name: 'Sender for Kiln Street Pottery' })).toBeTruthy();
  });

  it('offers no Save workspace to someone who may not save apps', () => {
    mount(['connections.manage']);
    const row = screen.getByTestId('workspace-row-wsp-ks');
    expect(within(row).queryByRole('button', { name: 'Save workspace' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Sender' })).toBeTruthy();
  });

  it('lists, in Delete, what the workspace alone shows', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(screen.getByTestId('workspace-row-wsp-ks')).getByRole('button', { name: 'Delete' }));
    const items = await screen.findAllByTestId('shown-only-in-item');
    expect(items.map((item) => item.textContent)).toEqual(['Firing doneEmail template', 'WholesaleInvoice layout']);
    expect(screen.getByTestId('shown-only-in').textContent).toContain('2 items are listed only here');
  });
});

describe('Save workspace’s More choices', () => {
  it('opens Save as app’s wizard on that database, and its choices go back to the dialog’s next plan', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(screen.getByTestId('workspace-row-wsp-fc')).getByRole('button', { name: 'Save workspace' }));
    await screen.findByText('Save Fernhill Coffee as one file');
    await user.click(await screen.findByRole('button', { name: /More choices/ }));

    const wizard = await screen.findByRole('dialog', { name: 'More choices for fernhill' });
    // The database is the row's: the wizard opens on What to include, with no way back to a database step and no Download.
    await waitFor(() => expect(wizard.textContent).toContain('Step 2 of 4 · fernhill-ops'));
    expect(wizard.textContent).not.toContain('Download');
    expect(within(wizard).queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    const use = await within(wizard).findByRole('button', { name: 'Use these choices' });
    await waitFor(() => expect((use as HTMLButtonElement).disabled).toBe(false));
    const before = calls.filter((call) => call.url === '/api/v1/workspaces/wsp-fc/save/plan').length;
    await user.click(use);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More choices for fernhill' })).toBeNull());
    await waitFor(() => expect(calls.filter((call) => call.url === '/api/v1/workspaces/wsp-fc/save/plan').length).toBeGreaterThan(before));
    const sent = calls.filter((call) => call.url === '/api/v1/workspaces/wsp-fc/save/plan').at(-1)!.body as { apps: Record<string, unknown>[] };
    expect(sent.apps[0]).toMatchObject({ connectionId: 'c-fernhill', key: 'fernhill-ops', name: 'Fernhill Ops', include: { tables: ['public.orders'] } });
    // The dialog is still there, with its rows.
    expect(screen.getByText('Save Fernhill Coffee as one file')).toBeTruthy();
  });

  it('turns the wizard’s request into one app of a workspace file', () => {
    expect(
      workspaceAppOf({ connectionId: 'c1', key: 'ops', name: 'Ops', version: '1.0.2', description: 'Shop', icon: 'coffee', label: 'x', include: { tables: ['public.a'] }, rows: { 'public.a': { mode: 'starting' } }, answers: { leaveOut: ['view:v1'] } }),
    ).toEqual({ connectionId: 'c1', key: 'ops', name: 'Ops', version: '1.0.2', description: 'Shop', icon: 'coffee', include: { tables: ['public.a'] }, rows: { 'public.a': { mode: 'starting' } }, answers: { leaveOut: ['view:v1'] } });
  });
});
