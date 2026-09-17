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
import { gridColumnSpecSchema } from '@adminium/widgets';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCrudDerived, type CrudDerivedConfig } from '@adminium/engine/config';

import { createQueryClient } from '../../app/query.js';
import { jsonResponse } from '../../test/fixtures.js';
import { ColumnManager, parseStoredColumns, type StoredColumn } from './ColumnManager.js';
import { savePageConfig } from './pagesApi.js';

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
          // A varchar(40): wide enough for a file id, far too narrow for a
          // link or a storage key. The width refusal is asserted against it.
          {
            name: 'pdf_url',
            ordinal: 5,
            logicalType: 'varchar',
            maxLength: 40,
            nullable: true,
            semantics: { primary: 'file-ref', format: null, flags: {} },
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
          // Foldable numbers: what the inbound sub-picker offers to sum.
          { name: 'qty', ordinal: 3, logicalType: 'decimal', nullable: true },
          {
            name: 'rate',
            ordinal: 4,
            logicalType: 'decimal',
            nullable: true,
            semantics: { primary: 'money', format: 'currency', flags: {} },
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

/**
 * The destinations reply the File section's picker reads. A refusal is the
 * ordinary case, not an edge one: an admin who may edit pages need not hold
 * `storage.manage`, so the 403 shape is a fixture like any other.
 */
const NO_DESTINATIONS = { status: 200, body: { data: [] } };
const FORBIDDEN_DESTINATIONS = {
  status: 403,
  body: { error: { code: 'FORBIDDEN', message: 'storage.manage is required.' } },
};

function stubFetch(
  reply: unknown = schemaReply,
  storage: { status: number; body: unknown } = NO_DESTINATIONS,
): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ method, path, body });
      if (path.includes('/storage/destinations')) return jsonResponse(storage.status, storage.body);
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
    {
      name: 'client_id',
      label: 'Client',
      logicalType: 'integer',
      semantic: 'fk',
      fk: { table: 'main.clients', column: 'client_id' },
    },
  ],
  pageSize: 50,
};

/**
 * Plays EditPageScreen's part: holds the reported draft and writes the assembled
 * config body at revision 3. The screen — not this component — owns the write,
 * so the harness does the assembling too.
 */
function Harness({
  config: pageConfig,
  source = { connectionId: 'conn_1', table: 'main.invoices' },
}: {
  config: Record<string, unknown>;
  source?: { connectionId: string | null; table: string | null };
}) {
  // The SCREEN owns every part of the config body — both the columns draft and
  // `config.derived`, which two surfaces write. The harness plays that part.
  const [draft, setDraft] = useState<StoredColumn[] | null>(null);
  const [derivedDraft, setDerivedDraft] = useState<CrudDerivedConfig | null>(null);
  const stored = parseCrudDerived(pageConfig['derived']);
  const derived = derivedDraft ?? (stored.ok ? stored.value : { measures: [], fields: [] });
  const columns = draft ?? parseStoredColumns(pageConfig);
  return (
    <>
      <ColumnManager
        columns={columns}
        onColumnsChange={setDraft}
        source={source}
        derived={derived}
        onDerivedChange={setDerivedDraft}
      />
      <button
        type="button"
        disabled={draft === null && derivedDraft === null}
        onClick={() => {
          void savePageConfig(
            'page_1',
            {
              ...pageConfig,
              ...(draft === null ? {} : { columns: draft }),
              ...(derivedDraft === null ? {} : { derived: derivedDraft }),
            },
            3,
          );
        }}
        data-testid="harness-save"
      >
        save
      </button>
    </>
  );
}

function renderManager(
  overrides: Partial<Record<string, unknown>> = {},
  storage: { status: number; body: unknown } = NO_DESTINATIONS,
) {
  const calls = stubFetch(schemaReply, storage);
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Harness config={{ ...config, ...overrides }} />
    </QueryClientProvider>,
  );
  return { calls, view };
}

/** The `config.columns` of the LAST save the harness made. */
function savedColumns(calls: Recorded[]): Record<string, unknown>[] {
  const patches = calls.filter((call) => call.method === 'PATCH');
  return (patches.at(-1)?.body as { config: { columns: Record<string, unknown>[] } }).config.columns;
}

async function saveAndCount(
  user: ReturnType<typeof userEvent.setup>,
  calls: Recorded[],
  expected: number,
): Promise<void> {
  await user.click(screen.getByTestId('harness-save'));
  await waitFor(() => {
    expect(calls.filter((call) => call.method === 'PATCH').length).toBe(expected);
  });
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
    // The relation is named by the ROW; the Count button is one affordance on
    // it, beside the fold sub-picker.
    const row = within(browser).getByTestId('studio-pages-inbound-line_items-invoice_id');
    expect(row.textContent).toContain('line_items');
    expect(row.textContent).toContain('invoice_id');
    await user.click(within(row).getByTestId('studio-pages-add-count-line_items-invoice_id'));

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

  it('turns the mask treatment on and off per column, either direction', async () => {
    // Generation seeds `pii` from the connection's classifier, so a page ends
    // up masking columns nobody chose to mask — and there was no way to say
    // otherwise. Both directions matter: an admin may also want to mask a
    // column the classifier never flagged.
    const { calls } = renderManager({
      columns: [
        { name: 'client_email', label: 'Client Email', logicalType: 'varchar', pii: true },
        { name: 'title', label: 'Title', logicalType: 'varchar' },
      ],
    });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('studio-pages-mask-client_email'));
    await user.click(screen.getByTestId('studio-pages-mask-title'));
    await user.click(screen.getByTestId('harness-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')).toBeDefined();
    });
    const columns = (calls.find((call) => call.method === 'PATCH')?.body as {
      config: { columns: Array<Record<string, unknown>> };
    }).config.columns;
    expect(columns[0]).toMatchObject({ name: 'client_email', pii: false });
    expect(columns[1]).toMatchObject({ name: 'title', pii: true });
  });

  it('badges the treatment, not the classification, and follows the switch', async () => {
    // The badge used to read "PII" off this same flag. Now that the flag is an
    // editable display choice, that word made a claim about the DATA that a
    // toggle could falsify in one click — so it names the treatment instead.
    renderManager({
      columns: [{ name: 'client_email', label: 'Client Email', logicalType: 'varchar', pii: true }],
    });
    const user = userEvent.setup();

    expect(await screen.findByText('Masked')).toBeDefined();
    expect(screen.queryByText('PII')).toBeNull();

    await user.click(screen.getByTestId('studio-pages-mask-client_email'));
    expect(screen.queryByText('Masked')).toBeNull();
  });

  it('offers the avatar switch on every column, defaulting per column kind', async () => {
    // Every column, because the monogram belongs on the NAME and not on the FK
    // id beside it. The switch starts where the renderer would: on for an FK
    // chip (which has always drawn one), off everywhere else.
    renderManager();

    await screen.findByTestId('studio-pages-avatar-title');
    expect(
      screen.getByTestId('studio-pages-avatar-client_id').getAttribute('aria-checked'),
    ).toBe('true');
    for (const name of ['title', 'amount']) {
      expect(screen.getByTestId(`studio-pages-avatar-${name}`).getAttribute('aria-checked')).toBe(
        'false',
      );
    }
  });

  it('stores an explicit boolean either way, leaving the fk block alone', async () => {
    // `false` on the FK and `true` on a plain column are both explicit: the
    // stored flag is tri-state, and once touched a column must not drift back
    // to whatever its kind's default happens to be.
    const { calls } = renderManager();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('studio-pages-avatar-client_id'));
    await user.click(screen.getByTestId('studio-pages-avatar-title'));
    await user.click(screen.getByTestId('harness-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')).toBeDefined();
    });
    const columns = (calls.find((call) => call.method === 'PATCH')?.body as {
      config: { columns: Array<Record<string, unknown>> };
    }).config.columns;
    expect(columns[0]).toMatchObject({ name: 'title', avatar: true });
    expect(columns[2]).toMatchObject({ name: 'client_id', avatar: false });
    // The flag is the column's, not the relation's — the fk block is untouched.
    expect(columns[2]?.['fk']).toEqual({ table: 'main.clients', column: 'client_id' });
  });
});


/**
 * The inbound sub-picker. Two properties that are the whole reason this wave
 * exists: a relation stays reachable after someone counts it, and the editor
 * never authors a page the server refuses.
 */
describe('ColumnManager — folds over an inbound relation', () => {
  it('still offers a sum of a relation that already has a count', async () => {
    const user = userEvent.setup();
    renderManager({
      columns: [
        { name: 'invoice_id', label: 'Invoice', logicalType: 'integer', primaryKey: true },
        {
          name: 'line_items_count',
          label: 'Line items Count',
          logicalType: 'integer',
          reverse: { table: 'main.line_items', fkColumn: 'invoice_id', agg: 'count' },
          sortable: false,
        },
      ],
    });

    const browser = await openBrowser(user);
    // The link is STILL listed — the `|count` dedupe hides the Count button,
    // not the table. Filtering the whole relation out is what made a total of
    // the invoice items unreachable once someone had counted them.
    const row = within(browser).getByTestId('studio-pages-inbound-line_items-invoice_id');
    expect(within(row).queryByTestId('studio-pages-add-count-line_items-invoice_id')).toBeNull();
    expect(within(row).getByTestId('studio-pages-fold-fn-line_items-invoice_id')).toBeTruthy();
  });

  it('writes a measure and its column from one act, multiplying the chosen factors', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    const browser = await openBrowser(user);
    const row = within(browser).getByTestId('studio-pages-inbound-line_items-invoice_id');
    await user.click(within(row).getByTestId('studio-pages-fold-col-line_items-qty'));
    await user.click(within(row).getByTestId('studio-pages-fold-col-line_items-rate'));
    await user.click(within(row).getByTestId('studio-pages-add-fold-line_items-invoice_id'));

    await user.click(screen.getByTestId('harness-save'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    const { config: body } = calls.find((call) => call.method === 'PATCH')?.body as {
      config: {
        derived?: { measures: { id: string; fn: string; of?: { terms: { factors: string[] }[] } }[] };
        columns?: { name: string; derived?: { ref: string }; display?: { kind: string } }[];
      };
    };
    const measure = body.derived?.measures[0];
    expect(measure).toMatchObject({ fn: 'sum', table: 'main.line_items', fkColumn: 'invoice_id' });
    // ONE term of two factors: `sum(qty * rate)` — the gross an invoice never
    // stores — not two separate sums.
    expect(measure?.of?.terms).toEqual([{ sign: 'plus', factors: ['qty', 'rate'] }]);
    // The column that shows it, and its declared presentation: a fold has no
    // source column to inherit one from.
    const column = body.columns?.find((entry) => entry.derived !== undefined);
    expect(column?.derived?.ref).toBe(measure?.id);
    expect(column?.display?.kind).toBe('currency');
    // The legacy vocabulary is NOT widened — no `reverse` block is written.
    expect(body.columns?.some((entry) => 'reverse' in entry)).toBe(false);
  });

  it('stops offering projections at the shared server budget, counts AND measures together', async () => {
    const user = userEvent.setup();
    // 12 correlated subqueries already bought: 11 counts plus one measure.
    // The server budgets `agg=` and `compute=` together, so the editor must
    // too — otherwise a page authored to the editor's own limit 422s on read.
    renderManager({
      columns: [
        { name: 'invoice_id', label: 'Invoice', logicalType: 'integer', primaryKey: true },
        ...Array.from({ length: 11 }, (_, i) => ({
          name: `c${String(i)}`,
          label: `Count ${String(i)}`,
          logicalType: 'integer',
          reverse: { table: `main.t${String(i)}`, fkColumn: 'invoice_id', agg: 'count' },
          sortable: false,
        })),
        { name: 'gross', label: 'Gross', derived: { ref: 'gross' }, sortable: false },
      ],
      derived: {
        measures: [
          {
            id: 'gross',
            table: 'main.line_items',
            fkColumn: 'invoice_id',
            fn: 'sum',
            of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] },
          },
        ],
        fields: [],
      },
    });

    const browser = await openBrowser(user);
    expect(within(browser).queryByTestId('studio-pages-inbound-line_items-invoice_id')).toBeNull();
  });
});

/**
 * The File section.
 *
 * Two properties carry the rest: a page that was toggled on and off again is
 * the page it was (the whole reason the block is opt-in), and the editor
 * refuses a reference shape the physical column cannot hold, with the number
 * that does not fit. Everything else here is that the block's other fields
 * say "whatever the workspace says" by being ABSENT, never by being present
 * and empty.
 */
describe('ColumnManager — the File section', () => {
  /** The `<option>` elements of a `<select>`, as the DOM has them. */
  function optionsOf(select: HTMLElement): HTMLOptionElement[] {
    return [...select.querySelectorAll('option')];
  }

  it('offers the switch only where a column could hold a reference', async () => {
    renderManager();
    // A varchar and a text column can; a decimal, an integer and an FK id
    // cannot, and a control nobody can use on most rows of most pages is
    // noise rather than affordance.
    expect(await screen.findByTestId('studio-pages-file-title')).toBeTruthy();
    expect(screen.queryByTestId('studio-pages-file-amount')).toBeNull();
    expect(screen.queryByTestId('studio-pages-file-client_id')).toBeNull();
  });

  it('always shows a stored block, whatever the column type now says', async () => {
    // Generation seeds blocks and schemas drift. A block this editor hid would
    // be a block nobody could turn off.
    renderManager({
      columns: [{ name: 'amount', label: 'Amount', logicalType: 'decimal', file: { ref: 'id' } }],
    });
    expect(await screen.findByTestId('studio-pages-file-amount')).toBeTruthy();
    expect(screen.getByTestId('studio-pages-file-block-amount')).toBeTruthy();
    expect(screen.getByTestId('studio-pages-file-amount').getAttribute('aria-checked')).toBe('true');
    // Two "File"s on the row: the badge beside the column name, which reads at
    // a glance like Masked/Linked/Count do, and the switch's own label.
    expect(screen.getAllByText('File')).toHaveLength(2);
  });

  it('writes the default shape on, and removes the key entirely off', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    await saveAndCount(user, calls, 1);
    // ONE key: every other field of the block means "whatever the workspace
    // says" by being absent, so the smallest honest block is the shape alone.
    expect(savedColumns(calls)[0]).toMatchObject({ name: 'title', file: { ref: 'url' } });
    expect(Object.keys(savedColumns(calls)[0]?.['file'] as object)).toEqual(['ref']);

    await user.click(screen.getByTestId('studio-pages-file-title'));
    await saveAndCount(user, calls, 2);
    // Not `file: undefined` — no `file` key at all, and the whole array is the
    // array that was stored. This is D14: the block is opt-in, so a page that
    // was toggled on and off again cannot have moved.
    expect(savedColumns(calls)[0]).not.toHaveProperty('file');
    expect(savedColumns(calls)).toEqual(config.columns);
  });

  it('refuses a shape the column is too short for, naming the width it needs', async () => {
    const user = userEvent.setup();
    renderManager({ columns: [{ name: 'pdf_url', label: 'PDF', logicalType: 'varchar' }] });

    await user.click(await screen.findByTestId('studio-pages-file-pdf_url'));
    const select = await screen.findByTestId('studio-pages-file-ref-pdf_url');
    const options = optionsOf(select);

    const url = options.find((option) => option.value === 'url');
    expect(url?.disabled).toBe(true);
    expect(url?.textContent).toContain('200');
    expect(url?.textContent).toContain('40');

    const key = options.find((option) => option.value === 'key');
    expect(key?.disabled).toBe(true);
    expect(key?.textContent).toContain('160');

    // A file id is 31 characters and fits, so it is the way out of the refusal
    // — a picker with every option disabled would only be a dead end.
    const id = options.find((option) => option.value === 'id');
    expect(id?.disabled).toBe(false);

    // The default shape was written even though it does not fit, so the field
    // has to say so rather than look configured.
    expect(screen.getByText(/too short to hold that value/i)).toBeTruthy();
  });

  it('refuses nothing when the column has no declared width', async () => {
    const user = userEvent.setup();
    // `title` is an unbounded varchar in the fixture — the editor cannot prove
    // a refusal, and guessing one would block a legitimate choice.
    renderManager();
    await user.click(await screen.findByTestId('studio-pages-file-title'));
    for (const option of optionsOf(await screen.findByTestId('studio-pages-file-ref-title'))) {
      expect(option.disabled).toBe(false);
    }
  });

  it('narrows the accepted types to the chosen chips, and back to the workspace list', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    const chips = screen.getByTestId('studio-pages-file-accept-title');
    await user.click(within(chips).getByRole('button', { name: 'PDF' }));
    await user.click(within(chips).getByRole('button', { name: 'PNG' }));
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url', accept: ['pdf', 'png'] });

    // Every chip off is NOT `accept: []` — that would read as "this column
    // accepts nothing", which nobody means. It is the key going away.
    await user.click(within(chips).getByRole('button', { name: 'PDF' }));
    await user.click(within(chips).getByRole('button', { name: 'PNG' }));
    await saveAndCount(user, calls, 2);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url' });
  });

  it('offers the destinations it can list, defaulting to the workspace default', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager({}, {
      status: 200,
      body: {
        data: [
          { id: 'dest_1', name: 'Invoice bucket', disabled: false },
          { id: 'dest_2', name: 'Retired disk', disabled: true },
        ],
      },
    });

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    const picker = await screen.findByTestId('studio-pages-file-destination-title');
    await waitFor(() => {
      expect(optionsOf(picker).some((option) => option.value === 'dest_1')).toBe(true);
    });
    // A destination the operator turned off is not offered: pointing new
    // uploads at it would author a failure.
    expect(optionsOf(picker).some((option) => option.value === 'dest_2')).toBe(false);
    // The first option is the default, and it stores NOTHING.
    expect(optionsOf(picker)[0]?.value).toBe('');
    expect((picker as HTMLSelectElement).value).toBe('');

    await user.selectOptions(picker, 'dest_1');
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url', destinationId: 'dest_1' });
  });

  it('degrades to the default option when destinations cannot be listed', async () => {
    const user = userEvent.setup();
    // An admin who may edit pages need not hold `storage.manage`. There is
    // nothing here for them to fix, so there is nothing to tell them.
    const { calls } = renderManager({}, FORBIDDEN_DESTINATIONS);

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    const picker = await screen.findByTestId('studio-pages-file-destination-title');
    await waitFor(() => {
      expect(calls.some((call) => call.path.includes('/storage/destinations'))).toBe(true);
    });
    expect(optionsOf(picker)).toHaveLength(1);
    expect(screen.queryByText(/storage.manage is required/)).toBeNull();
    // The rest of the block is still editable — the picker is one field of it.
    expect(screen.getByTestId('studio-pages-file-ref-title')).toBeTruthy();
  });

  it('keeps a stored destination it could not list, rather than repointing the column', async () => {
    const user = userEvent.setup();
    renderManager(
      {
        columns: [
          { name: 'title', label: 'Title', logicalType: 'varchar', file: { ref: 'id', destinationId: 'dest_gone' } },
        ],
      },
      FORBIDDEN_DESTINATIONS,
    );

    const picker = await screen.findByTestId('studio-pages-file-destination-title');
    expect((picker as HTMLSelectElement).value).toBe('dest_gone');
    // Named by its id, because that is genuinely all this reader knows.
    expect(optionsOf(picker).map((option) => option.value)).toEqual(['', 'dest_gone']);
    await user.click(screen.getByTestId('studio-pages-file-inline-title'));
    // Editing another field did not quietly move the column to the default.
    expect((screen.getByTestId('studio-pages-file-destination-title') as HTMLSelectElement).value).toBe(
      'dest_gone',
    );
  });

  it('authors the size cap in megabytes and stores bytes, and clears it back to absent', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    await user.type(screen.getByTestId('studio-pages-file-max-title'), '5');
    await user.click(screen.getByTestId('studio-pages-file-inline-title'));
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls)[0]?.['file']).toEqual({
      ref: 'url',
      maxBytes: 5 * 1_048_576,
      inline: true,
    });

    await user.clear(screen.getByTestId('studio-pages-file-max-title'));
    await user.click(screen.getByTestId('studio-pages-file-inline-title'));
    await saveAndCount(user, calls, 2);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url' });
  });

  it('leaves every other column alone when one grows a block', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls).slice(1)).toEqual(config.columns.slice(1));
  });

  // --- a column that holds many files ---------------------

  it('turns one column into a list and clears the flag back to absent', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    await user.click(screen.getByTestId('studio-pages-file-multiple-title'));
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url', multiple: true });

    await user.click(screen.getByTestId('studio-pages-file-multiple-title'));
    await saveAndCount(user, calls, 2);
    // Absent, not `multiple: false` — a page toggled on and off again has to
    // be the page it was, which is the same rule the `inline` flag follows.
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url' });
  });

  it('offers the per-record cap only for a list, and drops it with the flag', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    // A single-value column already holds at most one file, so the cap would
    // be a control that changes nothing.
    expect(screen.queryByTestId('studio-pages-file-max-count-title')).toBeNull();

    await user.click(screen.getByTestId('studio-pages-file-multiple-title'));
    await user.type(screen.getByTestId('studio-pages-file-max-count-title'), '3');
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url', multiple: true, maxCount: 3 });

    // Turning the list off takes the cap with it rather than leaving a number
    // nothing reads.
    await user.click(screen.getByTestId('studio-pages-file-multiple-title'));
    await saveAndCount(user, calls, 2);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url' });
  });

  it('clamps the cap to what the schema accepts', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    await user.click(screen.getByTestId('studio-pages-file-multiple-title'));
    // `columnFileSchema` caps this at 500 and `gridColumnSpecSchema` is
    // `.strict()`, so an out-of-range value makes the WHOLE column spec
    // unparseable — and the page route drops an unparseable column on read.
    await user.type(screen.getByTestId('studio-pages-file-max-count-title'), '9000');
    await saveAndCount(user, calls, 1);
    expect(savedColumns(calls)[0]?.['file']).toEqual({ ref: 'url', multiple: true, maxCount: 500 });
  });

  it('writes a block the grid schema actually accepts', async () => {
    const user = userEvent.setup();
    const { calls } = renderManager();

    await user.click(await screen.findByTestId('studio-pages-file-title'));
    await user.click(screen.getByTestId('studio-pages-file-multiple-title'));
    await user.type(screen.getByTestId('studio-pages-file-max-count-title'), '2');
    await saveAndCount(user, calls, 1);
    // The property behind the literals above: a spec this editor writes and
    // the renderer then refuses would be lost in silence on the next read.
    expect(gridColumnSpecSchema.safeParse(savedColumns(calls)[0]).success).toBe(true);
  });
});
