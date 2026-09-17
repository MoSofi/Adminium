// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Settings → Project: what a super admin sees about the project a
 * server runs, the states around it, and the way in from the settings hub.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ProjectOverviewDto } from './projectOverviewApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function overview(overrides: Partial<ProjectOverviewDto> = {}): ProjectOverviewDto {
  return {
    root: '/srv/shop-admin',
    version: '0.2.10',
    mode: 'server',
    codeEnabled: true,
    loadedAt: Date.now() - 60_000,
    actions: [
      {
        id: 'refund-order',
        source: 'actions/refund-order.ts',
        label: 'Refund',
        database: 'main',
        table: 'orders',
        bulk: true,
        permission: 'update',
      },
    ],
    hooks: [
      {
        source: 'hooks/orders.ts',
        database: 'main',
        table: 'orders',
        events: ['beforeCreate', 'afterUpdate'],
        onImport: true,
      },
    ],
    files: { pages: ['pages/customers.json', 'pages/orders.json'], schema: ['schema/main.json'] },
    pages: [
      { slug: 'revenue', source: 'pages/revenue.tsx', title: 'Revenue', group: 'library', hidden: false },
      { slug: 'debug', source: 'pages/debug.tsx', title: 'Debug', group: 'account', hidden: true },
    ],
    widgets: [
      { id: 'project.flag-cell', source: 'widgets/flag-cell.tsx', kind: 'cell' },
      { id: 'project.sales', source: 'widgets/sales.tsx', kind: 'card' },
    ],
    problems: [{ source: 'hooks/broken.ts', message: 'Could not load it: boom', at: 1 }],
    hookFailures: [
      {
        at: 1_750_000_000_000,
        source: 'hooks/orders.ts',
        event: 'afterUpdate',
        database: 'main',
        table: 'public.orders',
        message: 'mail server down',
      },
    ],
    changes: [
      {
        path: 'pages/orders.json',
        kind: 'page',
        name: 'orders',
        pageId: 'page_orders',
        status: 'changed-on-server',
        serverEditedAt: 1,
      },
    ],
    ...overrides,
  };
}

interface Stub {
  roles?: string[];
  /** Undefined answers 404, as a server with no project does. */
  overview?: ProjectOverviewDto;
}

function renderAt(path: string, stub: Stub = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.startsWith('/api/v1/bootstrap')) {
      return jsonResponse(200, { data: makeBootstrap({ roles: stub.roles ?? ['super-admin'] }) });
    }
    if (url === '/api/v1/project/overview' && stub.overview !== undefined) {
      return jsonResponse(200, { data: stub.overview });
    }
    if (url.startsWith('/api/v1/connections')) return jsonResponse(200, { connections: [] });
    if (url.startsWith('/api/v1/pages')) return jsonResponse(200, { data: [] });
    // What the settings hub itself loads for a super admin.
    const branding = { appName: 'Adminium', logoUrl: null, showVersion: true };
    if (url === '/api/v1/settings/workspace') return jsonResponse(200, { data: { branding } });
    if (url === '/api/v1/branding') return jsonResponse(200, { data: branding });
    if (url === '/api/v1/settings/security') {
      return jsonResponse(200, { data: { sessionTtlHours: 720, require2fa: false, passwordMinLength: 10 } });
    }
    if (url === '/api/v1/settings/email') {
      return jsonResponse(200, {
        data: {
          configured: false,
          host: null,
          port: null,
          user: null,
          from: null,
          secure: null,
          senders: [],
          maxAttachmentBytes: 10 * 1024 * 1024,
          publicOrigin: null,
        },
      });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router, fetchMock };
}

beforeAll(installTestI18n);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio → Settings → Project', () => {
  it('shows the folder, the code it loaded, what failed and what changed', async () => {
    const { user, router } = renderAt('/studio/settings/project', { overview: overview() });
    const page = await screen.findByTestId('studio-project');
    expect(await within(page).findByText('/srv/shop-admin')).toBeDefined();
    expect(within(page).getByText('0.2.10')).toBeDefined();
    expect(within(page).getByText('Server: the folder changes only with a deploy')).toBeDefined();

    const action = within(page).getByTestId('project-overview-action-refund-order');
    expect(action.textContent).toContain('Refund');
    expect(action.textContent).toContain('actions/refund-order.ts');
    expect(action.textContent).toContain('One or more records');
    expect(action.textContent).toContain('Needs: Edit');

    const hook = within(page).getByTestId('project-overview-hook-hooks/orders.ts');
    expect(hook.textContent).toContain('beforeCreate');
    expect(hook.textContent).toContain('Also for CSV imports');

    const revenue = within(page).getByTestId('project-overview-page-revenue');
    expect(within(revenue).getByRole('link', { name: 'Revenue' }).getAttribute('href')).toBe('/p/revenue');
    expect(revenue.textContent).toContain('pages/revenue.tsx');
    expect(revenue.textContent).toContain('Library');
    expect(revenue.textContent).not.toContain('Not in the sidebar');
    expect(within(page).getByTestId('project-overview-page-debug').textContent).toContain('Not in the sidebar');
    expect(within(page).getByTestId('project-overview-widget-project.flag-cell').textContent).toContain('Table cell');
    const sales = within(page).getByTestId('project-overview-widget-project.sales');
    expect(sales.textContent).toContain('Dashboard card');
    expect(sales.textContent).toContain('widgets/sales.tsx');

    expect(within(page).getByText('1 file did not load')).toBeDefined();
    expect(within(page).getByText('Could not load it: boom', { exact: false })).toBeDefined();
    expect(within(page).getByText('mail server down')).toBeDefined();
    expect(within(page).getByText('Changed on this server', { selector: 'span' })).toBeDefined();
    expect(within(page).getByText('2 files')).toBeDefined();

    await user.click(within(page).getByRole('button', { name: 'Resolve in Pages' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/studio/pages');
    });
  });

  it('says so when the server runs no project', async () => {
    renderAt('/studio/settings/project');
    expect(await screen.findByText('This server runs no project')).toBeDefined();
  });

  it('says project code never loads on the desktop app', async () => {
    renderAt('/studio/settings/project', {
      overview: overview({
        codeEnabled: false,
        loadedAt: null,
        actions: [],
        hooks: [],
        pages: [],
        widgets: [],
        problems: [],
        hookFailures: [],
      }),
    });
    expect(await screen.findByText('Not loaded: the desktop app never runs project code')).toBeDefined();
    expect(screen.getByText('No actions. A file in actions/ puts a button on records.')).toBeDefined();
    expect(screen.getByText('No pages. A .tsx file in pages/ adds a page of your own.')).toBeDefined();
    expect(screen.getByText('No widgets. A file in widgets/ adds a table cell or a dashboard card.')).toBeDefined();
    expect(screen.getByText('No hook has failed since the server started.')).toBeDefined();
  });

  it('is for super admins only, and asks nothing of the server otherwise', async () => {
    const { fetchMock } = renderAt('/studio/settings/project', { roles: ['admin'], overview: overview() });
    expect(await screen.findByText('Only a super admin can see the project this server runs.')).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/project/overview')).toBe(false);
  });

  it('is linked from the settings hub only when there is a project', async () => {
    const { user, router } = renderAt('/studio/settings', { overview: overview() });
    const open = await screen.findByRole('button', { name: 'Open project' });
    await user.click(open);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/studio/settings/project');
    });
    cleanup();

    renderAt('/studio/settings');
    await screen.findByRole('button', { name: 'Open public API' });
    expect(screen.queryByRole('button', { name: 'Open project' })).toBeNull();
  });
});
