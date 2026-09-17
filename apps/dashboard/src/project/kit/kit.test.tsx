// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project UI kit (49 §6.2), piece by piece, as a page written in a project
 * would use it: layout and controls, the data table, toasts through the app's
 * queue, the data hooks against the `/api/v1/data` routes, navigation, and a
 * page config rendered from code.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Component, useState, type ReactNode } from 'react';
import { PROJECT_UI_EXPORTS } from '@adminium/add-on-contracts/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../../app/api.js';
import type { BootstrapData } from '../../app/bootstrap.js';
import { PAGE_HOST } from '../../pages/PageRenderer.js';
import { PageHostContext } from '../../pages/pageHost.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { registerPageTemplate, type PageTemplateProps } from '../../pages/templates.js';
import { ShellHarness } from '../../test/shellHarness.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { ProjectPageContext, toLocalPageEnvelope } from '../pageConfig.js';
import { ProjectToastBridge } from '../toastBridge.js';
import { DataTable, Stat, toColumnSpec } from './data.js';
import { EmptyState, Icon, toast } from './feedback.js';
import { GeneratedPage } from './GeneratedPage.js';
import { Link, listParams, recordKey, useCurrentUser, useMutation, useNavigate, useRecord, useRecords } from './hooks.js';
import { projectUiKit } from './index.js';
import { Button, Input, Select, Switch } from './inputs.js';
import { Card, Grid, Page, Stack } from './layout.js';

const BOOTSTRAP: BootstrapData = makeBootstrap({
  project: { databases: { main: 'conn_main' }, client: { digest: 'd', pages: [], widgets: [] } },
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setCsrfToken('csrf-test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

/** The providers a project page has inside the app shell, and a router at `/p/test`. */
function renderInApp(ui: ReactNode, opts: { bootstrap?: BootstrapData } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], opts.bootstrap ?? BOOTSTRAP);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <ProjectToastBridge />
          <ShellHarness>{ui}</ShellHarness>
        </AppToastProvider>
      </QueryClientProvider>
    ),
  });
  const other = createRoute({ getParentRoute: () => rootRoute, path: '/p/$slug', component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([other]),
    history: createMemoryHistory({ initialEntries: ['/p/test'] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { ...view, router, queryClient };
}

class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <p role="alert">{this.state.error.message}</p>;
  }
}

describe('the kit object', () => {
  it('has exactly the names the runtime contract lists', () => {
    expect(Object.keys(projectUiKit).sort()).toEqual([...PROJECT_UI_EXPORTS].sort());
    expect(Object.isFrozen(projectUiKit)).toBe(true);
  });
});

describe('layout and controls', () => {
  it('puts the page title in the top bar, and lays out cards, stacks and grids', async () => {
    renderInApp(
      <Page title="Revenue" description="This quarter" actions={<Button>Export</Button>}>
        <Grid columns={3}>
          <Card title="Orders" description="Paid" actions={<Button variant="ghost">More</Button>}>
            <Stack direction="row" gap="sm" align="center" justify="between" wrap>
              <span>one</span>
              <span>two</span>
            </Stack>
          </Card>
          <Card padded={false}>bare</Card>
        </Grid>
      </Page>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Revenue' })).toBeTruthy();
    expect(screen.getByText('This quarter')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Orders' })).toBeTruthy();
    const stack = screen.getByText('one').parentElement;
    expect(stack?.className).toContain('flex-row');
    expect(stack?.className).toContain('justify-between');
    expect(screen.getByText('bare').parentElement?.className).toContain('md:grid-cols-2');
  });

  it('names inputs by their labels, and draws options, errors and switches', async () => {
    const onChecked = vi.fn();
    const onClick = vi.fn();
    renderInApp(
      <>
        <Input label="Name" hint="As on the invoice" defaultValue="Ada" />
        <Input label="Email" error="Required" />
        <Input aria-label="Bare" />
        <Select label="Status" options={['open', { value: 'done', label: 'Done', disabled: true }]} />
        <Switch label="Active" onCheckedChange={onChecked} />
        <Switch aria-label="unused" />
        <Button icon="refresh-cw" loading onClick={onClick}>
          Sync
        </Button>
      </>,
    );
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('Ada');
    expect(screen.getByText('As on the invoice')).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Bare')).toBeTruthy();
    const status = screen.getByLabelText('Status') as HTMLSelectElement;
    expect([...status.options].map((option) => [option.value, option.textContent, option.disabled])).toEqual([
      ['open', 'open', false],
      ['done', 'Done', true],
    ]);
    await userEvent.click(screen.getByRole('switch', { name: 'Active' }));
    expect(onChecked).toHaveBeenCalledWith(true);
    const sync = screen.getByRole('button', { name: /Sync/ });
    expect(sync.getAttribute('aria-busy')).toBe('true');
  });
});

describe('the data table', () => {
  it('formats values by type, and draws a column with its render function', async () => {
    const onRowClick = vi.fn();
    renderInApp(
      <DataTable
        columns={[
          { key: 'name', label: 'Name', render: (row) => <em>{String(row.name).toUpperCase()}</em> },
          { key: 'total', label: 'Total', type: 'money', currency: 'EUR' },
          { key: 'rate', label: 'Rate', type: 'percent' },
          { key: 'notes', label: 'Notes', render: () => undefined },
        ]}
        rows={[{ id: 1, name: 'ada', total: '12.5', rate: 8, notes: 'kept' }]}
        onRowClick={onRowClick}
      />,
    );
    expect((await screen.findByText('ADA')).tagName).toBe('EM');
    expect(screen.getByText(/12\.50/)).toBeTruthy();
    expect(screen.getByText(/8/).textContent).toContain('%');
    // `undefined` from a render function draws nothing, not the value.
    expect(screen.queryByText('kept')).toBeNull();
    await userEvent.click(screen.getByText('ADA'));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('shows a loading state, an empty state, or the caller’s own', async () => {
    const { rerender } = render(<DataTable columns={[{ key: 'a', label: 'A' }]} rows={undefined} loading />);
    expect(screen.getByTestId('project-table-loading')).toBeTruthy();
    rerender(<DataTable columns={[{ key: 'a', label: 'A' }]} rows={[]} />);
    expect(screen.getByText('No records')).toBeTruthy();
    rerender(<DataTable columns={[{ key: 'a', label: 'A' }]} rows={[]} empty={<p>Nothing yet</p>} />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });

  it('turns kit columns into grid column specs', () => {
    expect(toColumnSpec({ key: 'n', label: 'N', type: 'number' })).toMatchObject({ logicalType: 'decimal', align: 'end' });
    expect(toColumnSpec({ key: 'd', label: 'D', type: 'datetime', sortable: false })).toMatchObject({
      logicalType: 'timestamptz',
      sortable: false,
    });
    expect(toColumnSpec({ key: 'b', label: 'B', type: 'boolean', align: 'start' })).toMatchObject({
      logicalType: 'boolean',
      align: 'start',
    });
    expect(toColumnSpec({ key: 'm', label: 'M', type: 'money' })).toMatchObject({ semantic: 'money' });
  });

  it('draws a stat with its change and hint', () => {
    render(
      <>
        <Stat label="Revenue" value="€12k" delta={12.5} hint="vs last month" icon="euro" />
        <Stat label="Refunds" value="3" delta={-4} invertDelta />
        <Stat label="Flat" value="0" delta={0} />
      </>,
    );
    expect(screen.getByText('+12.5%')).toBeTruthy();
    // On a page a stat is a card of its own.
    expect(screen.getAllByTestId('project-stat')[0]?.parentElement?.classList.contains('shadow-card')).toBe(true);
    expect(screen.getByText('vs last month')).toBeTruthy();
    expect(screen.getByText('-4%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });
});

describe('feedback and icons', () => {
  it('shows a toast through the app queue, and says so when there is no app', async () => {
    renderInApp(<Button onClick={() => toast('Saved', { tone: 'info', description: 'All good', duration: null })}>Go</Button>);
    await userEvent.click(await screen.findByRole('button', { name: 'Go' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('warns instead of throwing when no app shell is mounted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    toast('Nobody hears this');
    expect(warn).toHaveBeenCalledWith('[project] toast() was called before the dashboard was ready:', 'Nobody hears this');
    warn.mockRestore();
  });

  it('draws empty states and icons, named or decorative', () => {
    const { container } = render(
      <>
        <EmptyState title="No orders" description="Try later" icon="inbox" actions={<button type="button">New</button>} />
        <Icon name="chart-line" label="Chart" size={20} />
        <Icon name="chart-line" />
      </>,
    );
    expect(screen.getByText('No orders')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Chart' })).toBeTruthy();
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});

describe('the data hooks', () => {
  it('turn kit queries into list parameters', () => {
    expect(listParams({})).toEqual({ limit: 50, offset: 0, count: 'estimated' });
    expect(
      listParams({ where: { status: 'paid', deleted_at: null }, search: '  ada ', orderBy: '-placed_at', limit: 5000, offset: -3 }),
    ).toEqual({
      where: {
        and: [
          { column: 'status', op: 'eq', value: 'paid' },
          { column: 'deleted_at', op: 'is_null' },
        ],
      },
      q: 'ada',
      order: [{ column: 'placed_at', dir: 'desc' }],
      limit: 200,
      offset: 0,
      count: 'estimated',
    });
    expect(listParams({ where: { id: 3 }, orderBy: 'name', search: ' ' })).toMatchObject({
      where: { column: 'id', op: 'eq', value: 3 },
      order: [{ column: 'name', dir: 'asc' }],
    });
    expect(recordKey(7)).toBe('7');
    expect(recordKey({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  it('read records by database key, as the signed-in person', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/orders/9')) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'gone' } });
      if (url.includes('/orders/1')) return jsonResponse(200, { data: { id: 1, status: 'paid' } });
      return jsonResponse(200, { data: [{ id: 1, status: 'paid' }], page: { limit: 50, offset: 0, total: 1 } });
    });
    function Orders() {
      const list = useRecords('main', 'orders', { where: { status: 'paid' } });
      const one = useRecord('main', 'orders', 1);
      const gone = useRecord('main', 'orders', 9);
      const none = useRecord('main', 'orders', null);
      const user = useCurrentUser();
      return (
        <p data-testid="out">
          {[
            list.isLoading ? 'loading' : `${String(list.data?.length)}/${String(list.total)}`,
            one.data?.status ?? '-',
            gone.isLoading ? '…' : String(gone.data),
            String(none.data),
            user.name,
            user.roles.join(','),
          ].join(' ')}
        </p>
      );
    }
    renderInApp(<Orders />);
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('1/1 paid null null Ava Reyes super-admin'));
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.startsWith('/api/v1/data/conn_main/orders?') && url.includes('where='))).toBe(true);
  });

  it('refuse a database the project does not have, by name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Orders() {
      useRecords('billing', 'orders');
      return null;
    }
    renderInApp(
      <Catch>
        <Orders />
      </Catch>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'There is no database "billing" in adminium.config.ts, or it has no connection yet.',
    );
    error.mockRestore();
  });

  it('write records, refresh what shows them, and refuse a delete other rows depend on', async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (method === 'DELETE' && url.includes('/orders/2')) {
        return jsonResponse(200, { references: [{ relationId: 'r', table: 'items', column: 'order_id', count: 3 }], requiresConfirm: true });
      }
      if (method === 'DELETE') return jsonResponse(200, { data: null, undoToken: null });
      return jsonResponse(200, { data: { id: 1, status: 'refunded' }, undoToken: null });
    });
    let mutation: ReturnType<typeof useMutation> | null = null;
    function Writer() {
      mutation = useMutation('main', 'orders');
      const [state, setState] = useState('');
      return (
        <p data-testid="state" data-pending={String(mutation.isPending)}>
          {state}
          {mutation.error?.message}
          <button type="button" onClick={() => setState('clicked')}>
            x
          </button>
        </p>
      );
    }
    const { queryClient } = renderInApp(<Writer />);
    await screen.findByTestId('state');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await expect(mutation?.create({ status: 'new' })).resolves.toEqual({ id: 1, status: 'refunded' });
      await expect(mutation?.update(1, { status: 'refunded' })).resolves.toMatchObject({ status: 'refunded' });
      await expect(mutation?.remove({ id: 1 })).resolves.toBeUndefined();
      await expect(mutation?.remove(2)).rejects.toThrow('Other records refer to this one. Pass { confirm: true } to delete it anyway.');
    });
    await waitFor(() => expect(screen.getByTestId('state').textContent).toContain('Other records refer to this one'));
    // The next call clears the last one's error.
    await act(async () => {
      await expect(mutation?.remove(3, { confirm: true })).resolves.toBeUndefined();
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /api/v1/data/conn_main/orders',
      'PATCH /api/v1/data/conn_main/orders/1',
      `DELETE /api/v1/data/conn_main/orders/${encodeURIComponent('{"id":1}')}`,
      'DELETE /api/v1/data/conn_main/orders/2',
      'DELETE /api/v1/data/conn_main/orders/3?confirm=true',
    ]);
    expect(calls[0]?.body).toEqual({ values: { status: 'new' } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['data', 'conn_main'] });
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('x'));
    expect(screen.getByTestId('state').getAttribute('data-pending')).toBe('false');
  });
});

describe('navigation', () => {
  it('moves within the dashboard, by link or by call', async () => {
    let seen = '';
    function Where() {
      seen = useRouterState({ select: (state) => state.location.pathname });
      return null;
    }
    function Go() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/p/orders')}>
          go
        </button>
      );
    }
    renderInApp(
      <>
        <Where />
        <Link to="/p/customers">Customers</Link>
        <Go />
      </>,
    );
    const link = await screen.findByRole('link', { name: 'Customers' });
    expect(link.getAttribute('href')).toBe('/p/customers');
    await userEvent.click(link);
    await waitFor(() => expect(seen).toBe('/p/customers'));
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(seen).toBe('/p/orders'));
  });

  it('refuses a place outside the dashboard', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderInApp(
      <Catch>
        <Link to="https://example.com">Away</Link>
      </Catch>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      '"https://example.com" is not a path in this dashboard. Use one such as /p/orders.',
    );
    error.mockRestore();
  });
});

describe('a page config in code', () => {
  it('maps database keys to connections, drops file keys and destination names, and sets the id', () => {
    const file = {
      $schema: '../node_modules/x.json',
      origin: 'generated',
      enabled: true,
      generated: { hash: 'h' },
      template: 'page-crud',
      source: { database: 'main', table: 'orders' },
      config: {
        uploads: { destination: 'bucket' },
        items: [{ binding: { database: null } }],
      },
    };
    expect(toLocalPageEnvelope(file, { main: 'conn_main' }, 'page_proj_x')).toEqual({
      ok: true,
      envelope: {
        template: 'page-crud',
        source: { connectionId: 'conn_main', table: 'orders' },
        config: { uploads: {}, items: [{ binding: { connectionId: null } }] },
        id: 'page_proj_x',
      },
    });
    expect(toLocalPageEnvelope({ source: { database: 'billing' } }, {}, 'page_x')).toEqual({
      ok: false,
      problems: ['source.database: "billing" is not a database in adminium.config.ts, or it has no connection yet'],
    });
  });

  it('renders with the page templates, inside the project page', async () => {
    const seen: PageTemplateProps[] = [];
    const unregister = registerPageTemplate('page-kit-test', (props) => {
      seen.push(props);
      return <p>template for {props.page.source.connectionId}</p>;
    });
    const page = {
      v: 1,
      kind: 'page',
      template: 'page-kit-test',
      title: { key: 'k', fallback: 'Orders' },
      source: { database: 'main', table: 'public.orders' },
      nav: { group: 'workspace', icon: 'file', order: 1 },
      access: { minRole: 'viewer', permissions: [] },
      config: {},
    };
    renderInApp(
      <PageHostContext.Provider value={PAGE_HOST}>
        <ProjectPageContext.Provider value={{ slug: 'my-orders', pageId: 'page_6f1c2a9d_orders' }}>
          <GeneratedPage page={page} />
          <GeneratedPage page={{ ...page, source: { database: 'billing', table: null } }} />
          <GeneratedPage page={{ ...page, title: 'not an object' }} />
        </ProjectPageContext.Provider>
      </PageHostContext.Provider>,
    );
    expect(await screen.findByText('template for conn_main')).toBeTruthy();
    // The id of the page it is drawn in.
    expect(seen[0]?.page.id).toBe('page_6f1c2a9d_orders');
    const invalid = await screen.findAllByText('This page’s configuration is invalid');
    expect(invalid).toHaveLength(2);
    expect(screen.getByText(/source\.database: "billing" is not a database/)).toBeTruthy();
    unregister();
  });
});
