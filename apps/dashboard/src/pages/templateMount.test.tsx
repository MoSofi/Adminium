// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `TemplateMount` when a template's code does not load: the render-error card
 * with a Retry that loads it again, instead of a skeleton that never ends.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageActionsProvider, usePageAssistant } from '../shell/PageActionsProvider.js';
import { PageAssistantButton } from '../shell/PageAssistantButton.js';
import { makeBootstrap, makeCrudEnvelope } from '../test/fixtures.js';
import { rememberListView } from './listView.js';
import { TemplateMount } from './PageRenderer.js';
import { AppToastProvider } from './toasts.js';

const resolvePageTemplate = vi.hoisted(() => vi.fn());
vi.mock('./templates.js', async (original) => ({
  ...(await original<typeof import('./templates.js')>()),
  resolvePageTemplate,
}));

afterEach(() => {
  resolvePageTemplate.mockReset();
});

function renderInRouter(ui: ReactNode, bootstrap = makeBootstrap()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], bootstrap);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>{ui}</AppToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(<RouterProvider router={router} />);
}

describe('TemplateMount', () => {
  it('shows the render-error card when a template does not load, and loads it again on Retry', async () => {
    resolvePageTemplate
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module: /assets/PageCrudBinding.js'))
      .mockResolvedValueOnce(() => <p>the template</p>);
    renderInRouter(<TemplateMount page={makeCrudEnvelope()} slug="customers" />);
    expect(await screen.findByText('This page failed to render')).toBeTruthy();
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeTruthy();
    expect(screen.queryByTestId('page-skeleton')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('the template')).toBeTruthy();
    expect(resolvePageTemplate).toHaveBeenCalledTimes(2);
  });

  it('turns a non-error rejection into a message', async () => {
    resolvePageTemplate.mockRejectedValueOnce('chunk gone');
    renderInRouter(<TemplateMount page={makeCrudEnvelope()} slug="customers" />);
    expect(await screen.findByText('chunk gone')).toBeTruthy();
  });
});

describe('what a page tells the assistant about itself', () => {
  /** The shell's two readers: the published context as text, and the Ask button drawn from it. */
  function Shell({ children, bootstrap = makeBootstrap() }: { children: ReactNode; bootstrap?: ReturnType<typeof makeBootstrap> }) {
    return (
      <PageActionsProvider>
        <header>
          <Published />
          <PageAssistantButton bootstrap={bootstrap} />
        </header>
        {children}
      </PageActionsProvider>
    );
  }
  function Published() {
    const page = usePageAssistant();
    return <output data-testid="published">{page === null ? 'none' : JSON.stringify(page)}</output>;
  }
  const published = () => {
    const text = screen.getByTestId('published').textContent ?? 'none';
    return text === 'none' ? null : (JSON.parse(text) as { context: string; host: Record<string, unknown>; shown: Record<string, unknown> });
  };
  const allowed = () => makeBootstrap({ assistant: { allowed: true, name: 'Milo' } } as never);

  it('says which page it is, by the page and never by a table, and the shell draws its Ask button', async () => {
    resolvePageTemplate.mockResolvedValue(() => <p>the template</p>);
    renderInRouter(
      <Shell bootstrap={allowed()}>
        <TemplateMount page={makeCrudEnvelope()} slug="customers" />
      </Shell>,
      allowed(),
    );
    await screen.findByText('the template');
    await waitFor(() => expect(published()).toMatchObject({ context: 'data', host: { connectionIds: ['conn_1'], pageId: 'page_customers' } }));
    expect(published()?.host).toEqual({ connectionIds: ['conn_1'], pageId: 'page_customers' });
    expect(JSON.stringify(published())).not.toContain('public.customers');
    expect(await screen.findByTestId('ask-assistant')).toBeTruthy();
  });

  it('on a record, says which record is open and what the list it came from was showing', async () => {
    rememberListView('page_customers', { q: 'ada', order: 'name.asc' });
    resolvePageTemplate.mockResolvedValue(() => <p>the record</p>);
    renderInRouter(
      <Shell bootstrap={allowed()}>
        <TemplateMount page={makeCrudEnvelope()} slug="customers" recordId="42" />
      </Shell>,
      allowed(),
    );
    await screen.findByText('the record');
    await waitFor(() => expect(published()?.host.view).toEqual({ q: 'ada', order: 'name.asc', recordId: '42' }));
    // And, for the person, what the panel calls the page and the record open on it.
    expect(published()?.shown).toEqual({ title: 'Customers', record: 'Customers #42' });
  });

  it.each(['page-files', 'page-settings', 'page-builder', 'project-page', 'page-log-viewer'])(
    'publishes nothing for %s, which is not a view of a table`s rows: no Ask button there',
    async (template) => {
      resolvePageTemplate.mockResolvedValue(() => <p>the template</p>);
      renderInRouter(
        <Shell bootstrap={allowed()}>
          <TemplateMount page={makeCrudEnvelope({ template })} slug="customers" />
        </Shell>,
        allowed(),
      );
      await screen.findByText('the template');
      expect(published()).toBeNull();
      expect(screen.queryByTestId('ask-assistant')).toBeNull();
    },
  );

  it('draws no Ask button for a person who may not use the assistant', async () => {
    resolvePageTemplate.mockResolvedValue(() => <p>the template</p>);
    renderInRouter(
      <Shell>
        <TemplateMount page={makeCrudEnvelope()} slug="customers" />
      </Shell>,
    );
    await screen.findByText('the template');
    await waitFor(() => expect(published()).not.toBeNull());
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
  });
});
