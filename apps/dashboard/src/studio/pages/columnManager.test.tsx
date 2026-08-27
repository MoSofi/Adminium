// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column manager: drag handles instead of arrow buttons, and the unified `+`
 * column browser — re-adding a removed schema column (the "deleted a column
 * and couldn't get it back" gap) and composing lookup columns by walking FK
 * links, in ONE flow. Saving is the edit screen's: the manager only reports a
 * draft handle through `onDraft`, so the harness here plays the screen's role
 * (a save button that invokes the handle with the page revision). Pointer-drag
 * itself is not simulated (dnd-kit needs real element rects, which jsdom does
 * not lay out); the reorder algebra is dnd-kit's `arrayMove` and the handle
 * wiring is asserted structurally.
 */
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { jsonResponse } from '../../test/fixtures.js';
import { ColumnManager, type ColumnsDraft } from './ColumnManager.js';

const schemaReply = {
  connectionId: 'conn_1',
  snapshotId: 'snap_1',
  checksum: 'x',
  createdAt: 0,
  source: 'introspection',
  appliedOverrides: 0,
  model: {
    enums: [],
    tables: [
      {
        id: 'main.invoices',
        schema: 'main',
        name: 'invoices',
        rowCountEstimate: null,
        primaryKey: ['invoice_id'],
        columns: [
          { name: 'invoice_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'title', ordinal: 2, logicalType: 'varchar', semantics: { primary: 'free-text', format: null, flags: {} } },
          { name: 'amount', ordinal: 3, logicalType: 'decimal', semantics: { primary: 'money', format: 'currency', flags: {} } },
          {
            name: 'client_id',
            ordinal: 4,
            logicalType: 'integer',
            references: { tableId: 'main.clients', column: 'client_id' },
            semantics: { primary: 'fk', format: null, flags: {} },
          },
        ],
      },
      {
        id: 'main.clients',
        schema: 'main',
        name: 'clients',
        rowCountEstimate: null,
        primaryKey: ['client_id'],
        columns: [
          { name: 'client_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'name', ordinal: 2, logicalType: 'varchar', semantics: { primary: 'person-name', format: null, flags: {} } },
          {
            name: 'company_id',
            ordinal: 3,
            logicalType: 'integer',
            references: { tableId: 'main.companies', column: 'company_id' },
            semantics: { primary: 'fk', format: null, flags: {} },
          },
        ],
      },
      {
        id: 'main.companies',
        schema: 'main',
        name: 'companies',
        rowCountEstimate: null,
        primaryKey: ['company_id'],
        columns: [
          { name: 'company_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'name', ordinal: 2, logicalType: 'varchar', semantics: { primary: 'plain', format: null, flags: {} } },
        ],
      },
      // References invoices — the "Tables that link here" (count) section.
      {
        id: 'main.line_items',
        schema: 'main',
        name: 'line_items',
        rowCountEstimate: null,
        primaryKey: ['line_id'],
        columns: [
          { name: 'line_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
          {
            name: 'invoice_id',
            ordinal: 2,
            logicalType: 'integer',
            references: { tableId: 'main.invoices', column: 'invoice_id' },
            semantics: { primary: 'fk', format: null, flags: {} },
          },
        ],
      },
    ],
  },
};

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

function stubFetch(reply: unknown = schemaReply): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ method, path, body });
      if (path.includes('/schema')) return jsonResponse(200, reply);
      if (method === 'PATCH') {
        return jsonResponse(200, {
          data: { id: 'page_1', revision: 4, slug: 'invoices', type: 'page-crud', title: 'Invoices' },
        });
      }
      return jsonResponse(200, { data: [] });
    }),
  );
  return calls;
}

const config = {
  columns: [
    { name: 'title', label: 'Title', logicalType: 'varchar' },
    { name: 'amount', label: 'Amount', logicalType: 'decimal', semantic: 'money' },
    { name: 'client_id', label: 'Client', logicalType: 'integer', semantic: 'fk' },
  ],
  pageSize: 50,
};

/** Plays EditPageScreen's part: holds the reported draft, saves at revision 3. */
function Harness({
  config: pageConfig,
  source = { connectionId: 'conn_1', table: 'main.invoices' },
}: {
  config: Record<string, unknown>;
  source?: { connectionId: string | null; table: string | null };
}) {
  const [draft, setDraft] = useState<ColumnsDraft | null>(null);
  return (
    <>
      <ColumnManager pageId="page_1" config={pageConfig} source={source} onDraft={setDraft} />
      <button
        type="button"
        disabled={draft === null}
        onClick={() => {
          void draft?.save(3);
        }}
        data-testid="harness-save"
      >
        save
      </button>
    </>
  );
}

function renderManager(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = stubFetch();
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Harness config={{ ...config, ...overrides }} />
    </QueryClientProvider>,
  );
  return { calls, view };
}

async function openBrowser(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('studio-pages-add-open'));
  return screen.findByTestId('studio-pages-add-browser');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ColumnManager', () => {
  it('renders a drag handle per row and no arrow buttons', async () => {
    renderManager();
    expect(await screen.findByTestId('studio-pages-drag-title')).toBeTruthy();
    expect(screen.getByTestId('studio-pages-drag-amount')).toBeTruthy();
    // The handle is the keyboard-sortable activator dnd-kit wires up.
    expect(screen.getByTestId('studio-pages-drag-title').getAttribute('aria-roledescription')).toBe(
      'sortable',
    );
    expect(screen.queryByLabelText(/move .* up/i)).toBeNull();
    expect(screen.queryByLabelText(/move .* down/i)).toBeNull();
  });

  it('reports no draft until something changes', async () => {
    renderManager();
    await screen.findByTestId('studio-pages-drag-title');
    expect((screen.getByTestId('harness-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-adds a removed column with the spec regeneration would produce', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByLabelText('Remove amount'));
    expect(screen.queryByLabelText('Header for amount')).toBeNull();

    await openBrowser(user);
    await user.click(await screen.findByTestId('studio-pages-add-pick-amount'));
    // Adding closes the browser and the row is back in the list.
    expect(screen.queryByTestId('studio-pages-add-browser')).toBeNull();
    expect(screen.getByLabelText('Header for amount')).toBeTruthy();

    await user.click(screen.getByTestId('harness-save'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((call) => call.method === 'PATCH');
    // The harness saves at revision 3 — the If-Match the screen would send.
    expect((patch?.body as { expectedRevision: number }).expectedRevision).toBe(3);
    const saved = (patch?.body as { config: { columns: { name: string }[] } }).config.columns;
    expect(saved.map((column) => column.name)).toEqual(['title', 'client_id', 'amount']);
    const readded = saved.at(-1) as Record<string, unknown>;
    // Composed through buildColumnDef, not a bare {name} — money facts intact.
    expect(readded).toMatchObject({
      name: 'amount',
      label: 'Amount',
      logicalType: 'decimal',
      semantic: 'money',
      format: 'currency',
      align: 'end',
    });
  });

  it('offers primary-key and never-listed columns for adding back', async () => {
    const user = userEvent.setup();
    renderManager();
    const browser = await openBrowser(user);
    // invoice_id is in the schema but not in the stored config — addable.
    expect(within(browser).getByTestId('studio-pages-add-pick-invoice_id')).toBeTruthy();
  });

  it('filters the browser by the search query', async () => {
    const user = userEvent.setup();
    renderManager();
    const browser = await openBrowser(user);
    await user.type(within(browser).getByTestId('studio-pages-add-search'), 'amo');
    expect(within(browser).queryByTestId('studio-pages-add-pick-invoice_id')).toBeNull();
    // Nothing links to a table matching "amo" either — the link section hides.
    expect(within(browser).queryByTestId('studio-pages-add-follow-client_id')).toBeNull();
    await user.click(await screen.findByLabelText('Remove amount'));
    expect(within(browser).getByTestId('studio-pages-add-pick-amount')).toBeTruthy();
  });

  it('builds a one-hop lookup column by following the link', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    const browser = await openBrowser(user);
    // The link row is titled by the table it reaches, not the FK column.
    expect(within(browser).getByTestId('studio-pages-add-follow-client_id').textContent).toContain(
      'clients',
    );
    await user.click(within(browser).getByTestId('studio-pages-add-follow-client_id'));
    await user.click(await screen.findByTestId('studio-pages-lookup-pick-name'));

    // The browser closes and the new row appears with the Linked badge.
    expect(screen.queryByTestId('studio-pages-add-browser')).toBeNull();
    expect(screen.getByText('client_id → name')).toBeTruthy();
    expect(screen.getByText('Linked')).toBeTruthy();

    await user.click(screen.getByTestId('harness-save'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((call) => call.method === 'PATCH');
    const saved = (patch?.body as { config: { columns: Record<string, unknown>[] } }).config.columns;
    expect(saved.at(-1)).toMatchObject({
      name: 'client_id__name',
      label: 'Client Name',
      lookup: { path: ['client_id'], select: 'name' },
      sortable: false,
      readOnly: true,
    });
  });

  it('follows a second hop into a third table', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await openBrowser(user);
    await user.click(await screen.findByTestId('studio-pages-add-follow-client_id'));
    await user.click(await screen.findByTestId('studio-pages-lookup-follow-company_id'));
    await user.click(await screen.findByTestId('studio-pages-lookup-pick-name'));

    await user.click(screen.getByTestId('harness-save'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((call) => call.method === 'PATCH');
    const saved = (patch?.body as { config: { columns: Record<string, unknown>[] } }).config.columns;
    expect(saved.at(-1)).toMatchObject({
      name: 'client_id__company_id__name',
      label: 'Company Name',
      lookup: { path: ['client_id', 'company_id'], select: 'name' },
    });
  });

  it('adds a reverse count column from the tables-that-link-here section', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    const browser = await openBrowser(user);
    const row = within(browser).getByTestId('studio-pages-add-count-line_items-invoice_id');
    expect(row.textContent).toContain('line_items');
    expect(row.textContent).toContain('invoice_id');
    await user.click(row);

    // The browser closes and the new row appears with the Count badge.
    expect(screen.queryByTestId('studio-pages-add-browser')).toBeNull();
    expect(screen.getByText('line_items ← invoice_id')).toBeTruthy();
    expect(screen.getByText('Count')).toBeTruthy();

    await user.click(screen.getByTestId('harness-save'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((call) => call.method === 'PATCH');
    const saved = (patch?.body as { config: { columns: Record<string, unknown>[] } }).config.columns;
    expect(saved.at(-1)).toMatchObject({
      name: 'line_items__count',
      label: 'Line Items Count',
      logicalType: 'integer',
      reverse: { table: 'main.line_items', fkColumn: 'invoice_id', agg: 'count' },
      sortable: false,
      readOnly: true,
    });
  });

  it('does not re-offer a count the page already shows', async () => {
    const user = userEvent.setup();
    renderManager({
      columns: [
        ...config.columns,
        {
          name: 'line_items__count',
          label: 'Line Items Count',
          logicalType: 'integer',
          reverse: { table: 'main.line_items', fkColumn: 'invoice_id', agg: 'count' },
          sortable: false,
          readOnly: true,
        },
      ],
    });
    const browser = await openBrowser(user);
    expect(
      within(browser).queryByTestId('studio-pages-add-count-line_items-invoice_id'),
    ).toBeNull();
    // The outbound sections are unaffected.
    expect(within(browser).getByTestId('studio-pages-add-follow-client_id')).toBeTruthy();
  });

  it('does not re-offer a lookup target the page already shows', async () => {
    const user = userEvent.setup();
    renderManager({
      columns: [
        ...config.columns,
        {
          name: 'client_id__name',
          label: 'Client Name',
          logicalType: 'varchar',
          lookup: { path: ['client_id'], select: 'name' },
          sortable: false,
          readOnly: true,
        },
      ],
    });
    await openBrowser(user);
    await user.click(await screen.findByTestId('studio-pages-add-follow-client_id'));
    // `name` is already on the page through this exact path — only the other
    // columns of `clients` are offered.
    expect(await screen.findByTestId('studio-pages-lookup-pick-client_id')).toBeTruthy();
    expect(screen.queryByTestId('studio-pages-lookup-pick-name')).toBeNull();
  });

  it('keeps the add affordance when every column was deleted', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByLabelText('Remove title'));
    await user.click(screen.getByLabelText('Remove amount'));
    await user.click(screen.getByLabelText('Remove client_id'));
    // The zero-column state still offers the browser — this was the "deleted a
    // column and cannot add it back" dead end.
    expect(screen.getByTestId('studio-pages-columns-empty')).toBeTruthy();
    const browser = await openBrowser(user);
    expect(within(browser).getByTestId('studio-pages-add-pick-title')).toBeTruthy();
  });

  it('hides the add affordance entirely when nothing is addable', async () => {
    // A one-table schema with no links, every column already on the page.
    const flat = {
      ...schemaReply,
      model: {
        enums: [],
        tables: [
          {
            id: 'main.notes',
            schema: 'main',
            name: 'notes',
            rowCountEstimate: null,
            primaryKey: ['id'],
            columns: [
              { name: 'id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'body', ordinal: 2, logicalType: 'text', semantics: { primary: 'free-text', format: null, flags: {} } },
            ],
          },
        ],
      },
    };
    stubFetch(flat);
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Harness
          config={{
            columns: [
              { name: 'id', label: 'Id', logicalType: 'integer' },
              { name: 'body', label: 'Body', logicalType: 'text' },
            ],
          }}
          source={{ connectionId: 'conn_1', table: 'main.notes' }}
        />
      </QueryClientProvider>,
    );
    await screen.findByTestId('studio-pages-drag-id');
    expect(screen.queryByTestId('studio-pages-add-open')).toBeNull();
  });

  it('shows the legacy empty state only when there is no schema to add from', async () => {
    stubFetch();
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Harness config={{ pageSize: 50 }} source={{ connectionId: null, table: null }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('studio-pages-no-columns')).toBeTruthy();
  });
});
