// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's `GeneratedPage` mounts a template itself (49-developer-projects.md
 * §6.2): inside the project page's gutter, with the render-error card and a
 * Retry that loads a template again when its code did not load, and the
 * unknown-template card.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PAGE_HOST } from '../../pages/PageRenderer.js';
import { PageHostContext } from '../../pages/pageHost.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { makeBootstrap } from '../../test/fixtures.js';
import { ProjectPageContext, type ProjectPageInfo } from '../pageConfig.js';
import { GeneratedPage } from './GeneratedPage.js';

const resolvePageTemplate = vi.hoisted(() => vi.fn());
vi.mock('../../pages/templates.js', async (original) => ({
  ...(await original<typeof import('../../pages/templates.js')>()),
  resolvePageTemplate,
}));

afterEach(() => {
  resolvePageTemplate.mockReset();
});

function renderInApp(ui: ReactNode, info: ProjectPageInfo = { slug: 'orders', pageId: 'page_proj_orders' }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    ['bootstrap'],
    makeBootstrap({ project: { databases: { main: 'conn_main' }, client: { digest: 'd', pages: [], widgets: [] } } }),
  );
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <PageHostContext.Provider value={PAGE_HOST}>
            <ProjectPageContext.Provider value={info}>{ui}</ProjectPageContext.Provider>
          </PageHostContext.Provider>
        </AppToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/p/orders'] }) });
  return render(<RouterProvider router={router} />);
}

/** A page file naming `template`. */
function pageFile(template: string, config: Record<string, unknown> = {}, table = 'orders') {
  return {
    v: 1,
    kind: 'page',
    template,
    title: { key: 'k', fallback: 'Orders' },
    source: { database: 'main', table },
    nav: { group: 'workspace', icon: 'file', order: 1 },
    access: { minRole: 'viewer', permissions: [] },
    config,
  };
}

/** A template that shows what it was given. */
function Shown({ recordId, canCreate, canUpdate }: { recordId?: string; canCreate?: boolean; canUpdate?: boolean }) {
  return (
    <p>
      record {recordId ?? 'none'}, create {String(canCreate)}, update {String(canUpdate)}
    </p>
  );
}

/** An ejected page on its record route, as `ProjectPageBinding` describes it. */
const EJECTED: ProjectPageInfo = {
  slug: 'orders',
  pageId: 'page_6f1c2a9d_orders',
  source: { connectionId: 'conn_main', table: 'orders' },
  recordId: '7',
  table: { canCreate: false, canUpdate: true },
};

describe('GeneratedPage', () => {
  it('renders the template without a second page gutter', async () => {
    resolvePageTemplate.mockResolvedValue(({ page }: { page: { id: string } }) => <p>inside {page.id}</p>);
    const { container } = renderInApp(<GeneratedPage page={pageFile('page-gp-plain')} />);
    expect(await screen.findByText('inside page_proj_orders')).toBeTruthy();
    expect(container.querySelector('[data-padding]')).toBeNull();
    expect(resolvePageTemplate).toHaveBeenCalledWith('page-gp-plain');
  });

  it('shows the render-error card when the template does not load, and loads it again on Retry', async () => {
    resolvePageTemplate
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module: /assets/PageCrudBinding.js'))
      .mockResolvedValueOnce(() => <p>loaded the second time</p>);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderInApp(<GeneratedPage page={pageFile('page-gp-retry')} />);
    expect(await screen.findByText('This page failed to render')).toBeTruthy();
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeTruthy();
    expect(screen.getByText('page-gp-retry')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('loaded the second time')).toBeTruthy();
    expect(resolvePageTemplate).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('needs the page it renders in', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<GeneratedPage page={pageFile('page-gp-alone')} />)).toThrow(
      'GeneratedPage renders inside an Adminium page.',
    );
    error.mockRestore();
  });

  it('draws its page\'s record route, with the person\'s permissions, for the page\'s own table', async () => {
    resolvePageTemplate.mockResolvedValue(Shown);
    renderInApp(<GeneratedPage page={pageFile('page-crud', { detail: { template: 'page-record' } })} />, EJECTED);
    expect(await screen.findByText('record 7, create false, update true')).toBeTruthy();
    expect(resolvePageTemplate).toHaveBeenCalledWith('page-record');
  });

  it('gives a config for another table neither', async () => {
    resolvePageTemplate.mockResolvedValue(Shown);
    renderInApp(
      <GeneratedPage page={pageFile('page-crud', { detail: { template: 'page-record' } }, 'customers')} />,
      EJECTED,
    );
    expect(await screen.findByText('record none, create undefined, update undefined')).toBeTruthy();
    expect(resolvePageTemplate).toHaveBeenCalledWith('page-crud');
  });

  it('shows the unknown-template card for a template this build does not have', async () => {
    resolvePageTemplate.mockResolvedValue(null);
    renderInApp(<GeneratedPage page={pageFile('page-gp-unknown')} />);
    expect(await screen.findByText('Unknown page template')).toBeTruthy();
    expect(screen.getByText('page-gp-unknown')).toBeTruthy();
  });
});
