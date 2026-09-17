// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Export Builder page through the real router at `/exports/new`: the
 * table list with its locked row, the step gating and its hints, the
 * no-access state, the columns step with its suggested chip, the preview
 * and the started card.
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

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const SCHEMA = {
  connectionId: 'conn_1',
  snapshotId: 'snap_1',
  checksum: 'x',
  createdAt: 1,
  source: 'live',
  appliedOverrides: 0,
  schemaAuthoring: { authorable: true, reason: null },
  model: {
    tables: [
      {
        id: 'main.invoices',
        schema: 'main',
        name: 'invoices',
        rowCountEstimate: 1248,
        primaryKey: ['id'],
        columns: [
          { name: 'id', ordinal: 0, logicalType: 'bigint', isPrimaryKey: true },
          { name: 'number', ordinal: 1, logicalType: 'text' },
          { name: 'client_id', ordinal: 2, logicalType: 'bigint', references: { tableId: 'main.clients', column: 'id' } },
          { name: 'tax_rate', ordinal: 3, logicalType: 'decimal' },
        ],
      },
      {
        id: 'main.clients',
        schema: 'main',
        name: 'clients',
        rowCountEstimate: 64,
        primaryKey: ['id'],
        columns: [
          { name: 'id', ordinal: 0, logicalType: 'bigint', isPrimaryKey: true },
          { name: 'company', ordinal: 1, logicalType: 'text' },
        ],
      },
      {
        id: 'main.invoice_items',
        schema: 'main',
        name: 'invoice_items',
        rowCountEstimate: 4391,
        primaryKey: ['id'],
        columns: [
          { name: 'id', ordinal: 0, logicalType: 'bigint', isPrimaryKey: true },
          { name: 'invoice_id', ordinal: 1, logicalType: 'bigint', references: { tableId: 'main.invoices', column: 'id' } },
          { name: 'line_total', ordinal: 2, logicalType: 'decimal', semantics: { primary: 'money' } },
        ],
      },
    ],
  },
};

function sources(locked: boolean) {
  return {
    connection: { id: 'conn_1', name: 'Outline production', dialect: 'postgres' },
    tables: [
      { id: 'main.invoices', schema: 'main', name: 'invoices', label: null, rowCountEstimate: 1248, columnCount: 4, canExport: !locked, usedBy: 1, pages: [{ id: 'page_inv', title: 'Invoices', columns: 3, linked: 1, totals: 1 }] },
      { id: 'main.clients', schema: 'main', name: 'clients', label: 'Clients', rowCountEstimate: 64, columnCount: 2, canExport: false, usedBy: 0, pages: [] },
      { id: 'main.invoice_items', schema: 'main', name: 'invoice_items', label: null, rowCountEstimate: 4391, columnCount: 3, canExport: !locked, usedBy: 0, pages: [] },
    ],
  };
}

const PREVIEW = {
  columns: [
    { key: 'id', header: 'ID', kind: 'base', numeric: true, masked: false },
    { key: 'number', header: 'Invoice number', kind: 'base', numeric: false, masked: false },
    { key: 'client_id', header: 'Client ID', kind: 'base', numeric: true, masked: false },
    { key: 'tax_rate', header: 'Tax rate', kind: 'base', numeric: true, masked: false },
    { key: 'client_id__company', header: 'Client company', kind: 'lookup', numeric: false, masked: false },
  ],
  rows: [['4021', 'INV-2041', '11', '20.00', 'Cobalt Legal']],
  raw: ['ID,Invoice number,Client ID,Tax rate,Client company', '4021,INV-2041,11,20.00,Cobalt Legal'],
  rowCount: 1248,
  rowCountKind: 'estimate',
  estimatedBytes: 74_880,
  sampleRows: 1,
};

function stubFetch(opts: { locked?: boolean } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: makeBootstrap({
            roles: ['admin'],
            nav: {
              groups: [
                {
                  key: 'workspace',
                  items: [{ pageId: 'page_inv', slug: 'invoices', labelKey: 'nav.invoices', fallback: 'Invoices', icon: 'file', order: 1, connectionId: 'conn_1', connectionName: 'Outline production' }],
                },
              ],
            },
          }),
        }),
      );
    }
    if (url.startsWith('/api/v1/exports/sources')) return Promise.resolve(jsonResponse(200, { data: sources(opts.locked === true) }));
    if (url.startsWith('/api/v1/connections/conn_1/schema')) return Promise.resolve(jsonResponse(200, SCHEMA));
    if (url.startsWith('/api/v1/exports/views')) return Promise.resolve(jsonResponse(200, { data: { views: [] } }));
    if (url === '/api/v1/exports/preview' && method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(jsonResponse(200, { data: PREVIEW }));
    }
    if (url === '/api/v1/exports' && method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(
        jsonResponse(202, {
          data: { id: 'exp_9', connectionId: 'conn_1', requestedBy: 'usr_1', source: (JSON.parse(String(init?.body)) as { source: unknown }).source, format: 'csv', status: 'processing', fileId: null, filename: null, sizeBytes: null, rowCount: null, error: null, jobId: 'job_9', createdAt: 1, completedAt: null, expiresAt: null },
        }),
      );
    }
    if (url === '/api/v1/exports' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: [] }));
    if (url.startsWith('/api/v1/exports/exp_9')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: { id: 'exp_9', connectionId: 'conn_1', requestedBy: 'usr_1', source: { kind: 'table', table: 'main.invoices' }, format: 'csv', status: 'ready', fileId: 'file_9', filename: 'invoices-2026-09-07.csv', sizeBytes: 100, rowCount: 1248, error: null, jobId: 'job_9', createdAt: 1, completedAt: 2, expiresAt: null },
        }),
      );
    }
    if (url.startsWith('/api/v1/jobs/')) {
      return Promise.resolve(jsonResponse(200, { data: { id: 'job_9', kind: 'export-run', status: 'succeeded', progress: { pct: 100 }, lastError: null } }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `nope ${method} ${url}`, requestId: 'req_t' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posts };
}

async function renderBuilder(opts: { locked?: boolean; search?: string } = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(opts);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [`/exports/new${opts.search ?? ''}`] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient };
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

describe('ExportBuilderPage', () => {
  it('lists the tables with the locked row, gates Continue on a table, and walks to the columns step', async () => {
    const user = userEvent.setup();
    await renderBuilder();
    expect(await screen.findByTestId('export-builder-table-invoices')).toBeTruthy();
    // The locked row is dimmed and says so; it is not hidden.
    const clients = screen.getByTestId('export-builder-table-clients');
    expect(within(clients).getByText('No export access')).toBeTruthy();
    expect(screen.getByTestId('export-builder-hint').textContent).toBe('Choose a table to continue.');
    expect((screen.getByTestId('export-builder-next') as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByTestId('export-builder-table-invoices'));
    expect(await screen.findByTestId('export-builder-start-from')).toBeTruthy();
    expect(screen.getByTestId('export-builder-start-page_inv').textContent).toContain('The columns of a page — Invoices');
    expect(screen.getByTestId('export-builder-hint').textContent).toBe('Starting from all columns of invoices.');
    expect(screen.getByTestId('export-builder-step-suffix').textContent).toBe('invoices');

    await user.click(screen.getByTestId('export-builder-next'));
    expect(await screen.findByTestId('export-builder-columns')).toBeTruthy();
    // Every non-secret column of the table, in order, under its sentence-case header.
    expect((screen.getByTestId('export-builder-header-number') as HTMLInputElement).value).toBe('Number');
    expect(screen.getByTestId('export-builder-summary').textContent).toBe('4 columns · 0 linked · 0 totals');
    expect(screen.getByTestId('export-builder-hint').textContent).toBe('4 columns will be written in this order.');
  });

  it('adds a suggested linked value, blocks Continue on a duplicate header, and refuses an empty file', async () => {
    const user = userEvent.setup();
    await renderBuilder();
    await user.click(await screen.findByTestId('export-builder-table-invoices'));
    await user.click(screen.getByTestId('export-builder-next'));
    await screen.findByTestId('export-builder-columns');

    await user.click(screen.getByTestId('export-builder-suggest-s:link:client_id'));
    expect(await screen.findByTestId('export-builder-row-client_id__company')).toBeTruthy();
    expect((screen.getByTestId('export-builder-header-client_id__company') as HTMLInputElement).value).toBe('Client company');
    expect(screen.getByTestId('export-builder-summary').textContent).toBe('5 columns · 1 linked · 0 totals');
    // Once in the file, the chip is gone.
    expect(screen.queryByTestId('export-builder-suggest-s:link:client_id')).toBeNull();

    const header = screen.getByTestId('export-builder-header-number') as HTMLInputElement;
    await user.clear(header);
    await user.type(header, 'Tax rate');
    expect(await screen.findByTestId('export-builder-dupe-number')).toBeTruthy();
    expect(screen.getByTestId('export-builder-hint').textContent).toBe('Two columns have the same header. Rename one to continue.');
    expect((screen.getByTestId('export-builder-next') as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByTestId('export-builder-remove-all'));
    expect(await screen.findByText('No columns yet')).toBeTruthy();
    expect(screen.getByTestId('export-builder-hint').textContent).toBe('Add at least one column to continue.');
    await user.click(screen.getByTestId('export-builder-reset'));
    expect(await screen.findByTestId('export-builder-row-number')).toBeTruthy();
  });

  it('previews through the server and exports the definition, then shows the started card', async () => {
    const user = userEvent.setup();
    const { posts } = await renderBuilder();
    await user.click(await screen.findByTestId('export-builder-table-invoices'));
    await user.click(screen.getByTestId('export-builder-next'));
    await screen.findByTestId('export-builder-columns');
    await user.click(screen.getByTestId('export-builder-suggest-s:link:client_id'));
    await screen.findByTestId('export-builder-row-client_id__company');
    await user.click(screen.getByTestId('export-builder-next'));

    expect(await screen.findByTestId('export-builder-sample-table')).toBeTruthy();
    expect(screen.getByText('Cobalt Legal')).toBeTruthy();
    const preview = posts.find((post) => post.url === '/api/v1/exports/preview')?.body as { source: { columns: { label: string }[] } };
    expect(preview.source.columns.map((column) => column.label)).toEqual(['ID', 'Number', 'Client ID', 'Tax rate', 'Client company']);
    expect(screen.getByTestId('export-builder-summary-rail').textContent).toContain('Kept for 30 days');
    expect(screen.getByTestId('export-builder-summary-rail').textContent).toContain('73 KB');
    expect(screen.getByTestId('export-builder-hint').textContent).toBe('The file downloads from Data exports when it is ready.');

    await user.click(screen.getByTestId('export-builder-tab-raw'));
    expect(await screen.findByText('4021,INV-2041,11,20.00,Cobalt Legal')).toBeTruthy();

    await user.click(screen.getByTestId('export-builder-next'));
    expect(await screen.findByTestId('export-builder-started')).toBeTruthy();
    const created = posts.find((post) => post.url === '/api/v1/exports')?.body as { source: { kind: string; columns: unknown[]; options: { headerRow: boolean } }; format: string };
    expect(created.source.kind).toBe('table');
    expect(created.source.columns).toHaveLength(5);
    expect(created.source.options.headerRow).toBe(true);
    expect(created.format).toBe('csv');
    await waitFor(() => expect(screen.getByTestId('export-builder-download').getAttribute('href')).toBe('/api/v1/exports/exp_9/download'));
    expect(screen.getByTestId('export-builder-progress-label').textContent).toContain('Ready');
  });

  it('shows the no-access state when every table is locked', async () => {
    await renderBuilder({ locked: true });
    expect(await screen.findByTestId('export-builder-no-access')).toBeTruthy();
    expect(screen.getByText('Nothing to export yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Roles & access' })).toBeTruthy();
    expect(screen.queryByTestId('export-builder-next')).toBeNull();
  });
});
