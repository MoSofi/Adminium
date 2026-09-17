// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `TemplateMount` when a template's code does not load: the render-error card
 * with a Retry that loads it again, instead of a skeleton that never ends.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeBootstrap, makeCrudEnvelope } from '../test/fixtures.js';
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

function renderInRouter(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], makeBootstrap());
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
