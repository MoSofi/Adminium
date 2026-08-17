// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved views on page-crud (M5-T06): saving the current grid captures the live
 * toolbar state, and applying a saved view round-trips that state back into the
 * CrudApi query params (search / sort / filters / page size).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CrudListParams, CrudListResult } from '@adminium/widgets';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeCrudEnvelope } from '../../test/fixtures.js';
import { AppToastProvider } from '../toasts.js';
import { PageCrudBinding } from '../PageCrudBinding.js';
import type { SavedView } from './viewsApi.js';

function fakeCrud(list: (params: CrudListParams) => Promise<CrudListResult>) {
  return {
    connectionId: 'conn_1',
    table: 'public.customers',
    list: vi.fn(list),
    get: vi.fn(async () => ({ data: { id: 1, name: 'A' }, references: [] })),
    create: vi.fn(async () => ({ data: {}, undoToken: null })),
    update: vi.fn(async () => ({ data: {}, undoToken: null })),
    remove: vi.fn(async () => ({ data: {}, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [] })),
  };
}

function stubViewsFetch(initialViews: SavedView[]) {
  const posted: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/views') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: { views: initialViews } }));
    }
    if (url.includes('/views') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      posted.push(body);
      const created: SavedView = {
        id: 'view_new',
        pageId: 'page_customers',
        userId: 'usr_test',
        name: String(body['name']),
        config: body['config'] as SavedView['config'],
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      };
      return Promise.resolve(jsonResponse(201, { data: created }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posted };
}

function renderBinding(crud: ReturnType<typeof fakeCrud>) {
  const queryClient = createQueryClient();
  const adapters = {
    crud: crud as never,
    dashboard: null,
    onEvent: vi.fn(),
    openRecord: vi.fn(),
    notifyUndoable: vi.fn(),
  };
  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <PageCrudBinding page={makeCrudEnvelope()} adapters={adapters} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

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

const okList = (): Promise<CrudListResult> =>
  Promise.resolve({ data: [{ id: 1, name: 'Acme' }], cursor: { next: null }, page: { limit: 50, offset: 0, total: 1 } });

describe('page-crud saved views', () => {
  it('saves the current grid state into a new view', async () => {
    const { posted } = stubViewsFetch([]);
    const crud = fakeCrud(okList);
    renderBinding(crud);

    // Set a non-default query: type into the toolbar search.
    const search = await screen.findByPlaceholderText(/Search public\.customers/);
    await userEvent.type(search, 'acme');

    // Open the switcher and save the current grid as a view.
    await userEvent.click(await screen.findByRole('button', { name: 'All records' }));
    await userEvent.click(await screen.findByText('Save current as view…'));
    await userEvent.type(await screen.findByPlaceholderText(/Active this month/), 'Acme customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Save view' }));

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]?.['name']).toBe('Acme customers');
    // The saved config captured the live search text.
    expect((posted[0]?.['config'] as { search?: string }).search).toBe('acme');
  });

  it('applies a saved view, round-tripping its state into the query', async () => {
    const saved: SavedView = {
      id: 'view_bar',
      pageId: 'page_customers',
      userId: 'usr_test',
      name: 'Bar filter',
      config: { v: 1, search: 'bar', sort: { column: 'name', dir: 'desc' }, filters: [], pageSize: 25 },
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    };
    stubViewsFetch([saved]);
    const crud = fakeCrud(okList);
    renderBinding(crud);

    // Apply the saved view from the switcher.
    await userEvent.click(await screen.findByRole('button', { name: 'All records' }));
    await userEvent.click(await screen.findByText('Bar filter'));

    // The grid re-queries with the view's exact search + sort + page size.
    await waitFor(() => {
      expect(crud.list).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'bar', limit: 25, order: [{ column: 'name', dir: 'desc' }] }),
      );
    });
  });
});
