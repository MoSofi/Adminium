// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of a project's browser code: the loader (runtime first,
 * integrity-checked preloads, a retry after a failure), the `project-page`
 * template, project cells in a table and project cards on a dashboard, each
 * with its failure states, and the realtime event that makes open pages load
 * a rebuilt file.
 *
 * Modules are handed in through the importer seam; `project-bundle.test.tsx`
 * builds and imports real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { clearAddOnRuntime, hasAddOnRuntime } from '@adminium/add-on-contracts/runtime';
import type { PageEnvelope } from '@adminium/engine/config';
import { CellValue, PageDashboard, gridColumnSpecSchema } from '@adminium/widgets';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateForRealtimeEvent } from '../api/realtime.js';
import type { BootstrapData, ProjectClientEntry } from '../app/bootstrap.js';
import { resolvePageTemplate } from '../pages/templates.js';
import { AppToastProvider } from '../pages/toasts.js';
import { makeBootstrap } from '../test/fixtures.js';
import { forgetProjectModules, loadProjectModule, setProjectModuleImporter } from './client.js';
import { Stat } from './kit/data.js';
import { useProjectPage } from './pageConfig.js';
import { ProjectScope, withProjectScope } from './scope.js';
import { ProjectPageBinding } from './ProjectPageBinding.js';
import { resetProjectRuntime } from './runtime.js';

const file = (path: string) => ({ url: `/api/v1/project/client/${path}`, integrity: `sha384-${path}` });

const entry = (module: string, extra: Partial<ProjectClientEntry> = {}): ProjectClientEntry => ({
  module: file(module),
  imports: [file('chunks/chunk-A.js')],
  styles: [],
  ...extra,
});

function bootstrapWith(client: NonNullable<BootstrapData['project']>['client']): BootstrapData {
  return makeBootstrap({ project: { databases: { main: 'conn_main' }, client } });
}

const CLIENT = {
  digest: 'd1',
  pages: [
    { slug: 'revenue', ...entry('pages/revenue-A.js', { styles: [file('pages/revenue-A.css')] }) },
    { slug: 'broken', ...entry('pages/broken-A.js') },
    { slug: 'empty', ...entry('pages/empty-A.js') },
    { slug: 'orders', ...entry('pages/orders-A.js') },
  ],
  widgets: [
    { id: 'project.flag', kind: 'cell' as const, title: null, ...entry('widgets/flag-A.js') },
    { id: 'project.throws', kind: 'cell' as const, title: null, ...entry('widgets/throws-A.js') },
    { id: 'project.sales', kind: 'card' as const, title: 'Sales', ...entry('widgets/sales-A.js') },
    { id: 'project.late', kind: 'card' as const, title: null, ...entry('widgets/late-A.js') },
  ],
};

let modules: Record<string, unknown | Error>;
let imported: string[];

// happy-dom would fetch every preloaded module and stylesheet from a server
// that is not there; a browser is what checks them, not this suite.
beforeAll(() => {
  const settings = (window as unknown as { happyDOM: { settings: Record<string, unknown> } }).happyDOM.settings;
  settings['disableJavaScriptFileLoading'] = true;
  settings['disableCSSFileLoading'] = true;
  settings['handleDisabledFileLoadingAsSuccess'] = true;
});

beforeEach(() => {
  imported = [];
  modules = {
    'pages/revenue-A.js': {
      default: { title: 'Revenue', component: ({ slug }: { slug: string }) => <p>Revenue page at {slug}</p> },
    },
    'pages/broken-A.js': new Error('Failed to fetch dynamically imported module'),
    'pages/empty-A.js': { default: { title: 'Empty' } },
    'pages/orders-A.js': {
      default: {
        title: 'Orders',
        component: function Orders() {
          const info = useProjectPage();
          return (
            <p>
              {info?.pageId} {info?.source?.table} record {info?.recordId} create {String(info?.table?.canCreate)}
            </p>
          );
        },
      },
    },
    'widgets/flag-A.js': {
      default: {
        kind: 'cell',
        component: ({ value, record, column }: { value: unknown; record: { id: number }; column: { label: string } }) => (
          <strong>
            {value ? 'Flagged' : 'Clear'} #{record.id} ({column.label})
          </strong>
        ),
      },
    },
    'widgets/throws-A.js': {
      default: {
        kind: 'cell',
        component: () => {
          throw new Error('cell exploded');
        },
      },
    },
    'widgets/sales-A.js': {
      default: {
        kind: 'card',
        component: ({ config, data }: { config: { title?: string }; data: unknown }) => (
          <>
            <p>
              Sales card {config.title} {data === null ? 'no data' : 'data'}
            </p>
            <Stat label="Orders" value="12" />
          </>
        ),
      },
    },
    'widgets/late-A.js': new Error('late failed'),
  };
  setProjectModuleImporter(async (url) => {
    const path = url.slice('/api/v1/project/client/'.length);
    imported.push(path);
    const found = modules[path];
    if (found instanceof Error) throw found;
    if (found === undefined) throw new Error(`no module ${path}`);
    return found;
  });
});

afterEach(() => {
  forgetProjectModules();
  clearAddOnRuntime();
  resetProjectRuntime();
  document.head.querySelectorAll('link[data-adminium-project]').forEach((link) => link.remove());
});

function renderWith(bootstrap: BootstrapData, ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], bootstrap);
  return render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <ProjectScope>{ui}</ProjectScope>
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

function projectPage(file: string | null, source: PageEnvelope['source'] = { connectionId: null, table: null }): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_proj_x',
    template: 'project-page',
    title: { key: 'k', fallback: 'X' },
    source,
    nav: { group: 'workspace', icon: 'file', order: 0 },
    access: { minRole: 'viewer', permissions: [] },
    config: file === null ? {} : { file },
  };
}

const adapters = {
  crud: null,
  dashboard: null,
  onEvent: () => undefined,
  openRecord: () => undefined,
  notifyUndoable: () => undefined,
};

describe('loading a module', () => {
  it('installs the runtime first, preloads with integrity, and shares one load per file', async () => {
    const target = entry('pages/revenue-A.js', { styles: [file('pages/revenue-A.css')] });
    const first = loadProjectModule(target);
    expect(loadProjectModule(target)).toBe(first);
    const loaded = (await first) as { title: string };
    expect(loaded.title).toBe('Revenue');
    expect(hasAddOnRuntime()).toBe(true);
    const links = [...document.head.querySelectorAll('link[data-adminium-project]')].map((link) => [
      link.getAttribute('rel'),
      link.getAttribute('href'),
      link.getAttribute('integrity'),
    ]);
    expect(links).toEqual([
      ['stylesheet', '/api/v1/project/client/pages/revenue-A.css', 'sha384-pages/revenue-A.css'],
      ['modulepreload', '/api/v1/project/client/chunks/chunk-A.js', 'sha384-chunks/chunk-A.js'],
      ['modulepreload', '/api/v1/project/client/pages/revenue-A.js', 'sha384-pages/revenue-A.js'],
    ]);
    // A second module sharing the chunk adds no second link for it.
    await loadProjectModule(entry('widgets/flag-A.js'));
    expect(document.head.querySelectorAll('link[href$="chunk-A.js"]')).toHaveLength(1);
    expect(imported).toEqual(['pages/revenue-A.js', 'widgets/flag-A.js']);
  });

  it('forgets a failed load, so the next attempt fetches again', async () => {
    const target = entry('pages/broken-A.js');
    await expect(loadProjectModule(target)).rejects.toThrow('Failed to fetch');
    modules['pages/broken-A.js'] = { default: { title: 'Fixed' } };
    await expect(loadProjectModule(target)).resolves.toEqual({ title: 'Fixed' });
    expect(imported).toEqual(['pages/broken-A.js', 'pages/broken-A.js']);
  });
});

describe('the project-page template', () => {
  it('renders the page component with its address', async () => {
    renderWith(bootstrapWith(CLIENT), <ProjectPageBinding page={projectPage('revenue')} adapters={adapters} />);
    expect(screen.getByTestId('project-page-loading')).toBeTruthy();
    expect(await screen.findByText('Revenue page at revenue')).toBeTruthy();
  });

  it('tells its code which page it is: an ejected page\'s table, record route and permissions', async () => {
    renderWith(
      bootstrapWith(CLIENT),
      <ProjectPageBinding
        page={projectPage('orders', { connectionId: 'conn_main', table: 'orders' })}
        adapters={adapters}
        recordId="9"
        canCreate={false}
      />,
    );
    expect(await screen.findByText('page_proj_x orders record 9 create false')).toBeTruthy();
  });

  it('says when the page is not in the running build', async () => {
    renderWith(bootstrapWith(CLIENT), <ProjectPageBinding page={projectPage('gone')} adapters={adapters} />);
    expect(await screen.findByText('This page is not in the running build')).toBeTruthy();
    expect(screen.getByText('pages/gone.tsx')).toBeTruthy();
  });

  it('says so on a server with no project code, and for a page row with no file', async () => {
    const { unmount } = renderWith(bootstrapWith(null), <ProjectPageBinding page={projectPage('revenue')} adapters={adapters} />);
    expect(await screen.findByText('This page is not in the running build')).toBeTruthy();
    unmount();
    renderWith(bootstrapWith(CLIENT), <ProjectPageBinding page={projectPage(null)} adapters={adapters} />);
    expect(await screen.findByText('pages/?.tsx')).toBeTruthy();
  });

  it('shows a load failure with a Retry that loads again', async () => {
    renderWith(bootstrapWith(CLIENT), <ProjectPageBinding page={projectPage('broken')} adapters={adapters} />);
    expect(await screen.findByText('This page’s code did not load')).toBeTruthy();
    expect(screen.getByText('Failed to fetch dynamically imported module')).toBeTruthy();
    modules['pages/broken-A.js'] = modules['pages/revenue-A.js'];
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Revenue page at broken')).toBeTruthy();
  });

  it('names a file whose default export is not a page', async () => {
    renderWith(bootstrapWith(CLIENT), <ProjectPageBinding page={projectPage('empty')} adapters={adapters} />);
    expect(await screen.findByText('pages/empty.tsx does not export default definePage({ component, … }).')).toBeTruthy();
  });
});

const column = (widget?: string) =>
  gridColumnSpecSchema.parse({ name: 'flagged', label: 'Flag', ...(widget === undefined ? {} : { widget }) });

describe('project cells', () => {
  it('draw the column with the widget, and the rest of the grid as usual', async () => {
    renderWith(
      bootstrapWith(CLIENT),
      <>
        <CellValue column={column('project.flag')} row={{ id: 4, flagged: true }} />
        <CellValue column={column()} row={{ id: 4, flagged: 'plain value' }} />
      </>,
    );
    expect(await screen.findByText('Flagged #4 (Flag)')).toBeTruthy();
    expect(screen.getByText('plain value')).toBeTruthy();
  });

  it('keep the value, with a mark, when the widget cannot draw it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWith(
      bootstrapWith(CLIENT),
      <>
        <CellValue column={column('project.nope')} row={{ flagged: 'one' }} />
        <CellValue column={column('project.sales')} row={{ flagged: 'two' }} />
        <CellValue column={column('project.throws')} row={{ flagged: 'three' }} />
      </>,
    );
    expect(await screen.findByRole('img', { name: 'This project has no widget project.nope.' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'project.sales is a card, not a table cell.' })).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'cell exploded' })).toBeTruthy();
    expect(screen.getAllByTestId('project-cell-undrawn').map((cell) => cell.firstChild?.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    error.mockRestore();
  });

  it('draw the plain value on a server with no project', () => {
    renderWith(makeBootstrap(), <CellValue column={column('project.flag')} row={{ flagged: 'as is' }} />);
    expect(screen.getByText('as is')).toBeTruthy();
    expect(screen.queryByTestId('project-cell-undrawn')).toBeNull();
  });
});

describe('project cards', () => {
  const layout = (widget: string, config: Record<string, unknown> = {}) => ({
    version: 1 as const,
    items: [{ i: 'a', widget, x: 0, y: 0, w: 4, h: 4, config }],
  });

  it('render on a dashboard, with the widget title and no data when unbound', async () => {
    renderWith(bootstrapWith(CLIENT), <PageDashboard layout={layout('project.sales')} />);
    expect(await screen.findByText('Sales card Sales no data')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeTruthy();
    // The frame is the card: the kit's stat draws no second one inside it.
    expect(screen.getByTestId('project-stat').parentElement?.classList.contains('shadow-card')).toBe(false);
  });

  it('let a layout item name its own title', async () => {
    renderWith(bootstrapWith(CLIENT), <PageDashboard layout={layout('project.sales', { title: 'Q3' })} />);
    expect(await screen.findByText('Sales card Q3 no data')).toBeTruthy();
  });

  it('show the frame’s error state for a card that does not load, and the missing card for an unknown id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWith(bootstrapWith(CLIENT), <PageDashboard layout={layout('project.late')} />);
    expect(await screen.findByText('late failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    error.mockRestore();
  });

  it('are unknown where the server runs no project', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderWith(makeBootstrap(), <PageDashboard layout={layout('project.sales')} />);
    await waitFor(() => expect(screen.getByText(/project\.sales/)).toBeTruthy());
    warn.mockRestore();
  });
});

describe('the template scope', () => {
  it('wraps each template once, and gives it the project providers', async () => {
    const Template = ({ page }: { page: PageEnvelope }) => (
      <CellValue column={column('project.flag')} row={{ id: 1, flagged: page.template === 'project-page' }} />
    );
    const Wrapped = withProjectScope(Template);
    expect(withProjectScope(Template)).toBe(Wrapped);
    expect(Wrapped.displayName).toBe('ProjectScope(Template)');
    const queryClient = new QueryClient();
    queryClient.setQueryData(['bootstrap'], bootstrapWith(CLIENT));
    render(
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <Wrapped page={projectPage('revenue')} adapters={adapters} />
        </AppToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Flagged #1 (Flag)')).toBeTruthy();
  });

  it('resolves built-in templates inside the scope', async () => {
    const component = await resolvePageTemplate('project-page');
    expect((component as { displayName?: string } | null)?.displayName).toBe(
      'ProjectScope(AppPageNotice(ProjectPageBinding))',
    );
  });
});

describe('a rebuild', () => {
  it('refreshes the bootstrap, the pages, the actions and the Studio overview', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    invalidateForRealtimeEvent(queryClient, {
      channel: 'config-changed',
      type: 'project-changed',
      data: { digest: 'd2' },
      ts: '2026-09-17T00:00:00Z',
    });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['bootstrap'],
      ['page'],
      ['onboarding'],
      ['project'],
      ['studio', 'project'],
    ]);
  });
});
