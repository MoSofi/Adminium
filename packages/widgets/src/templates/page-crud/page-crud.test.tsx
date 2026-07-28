// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageCrud } from './PageCrud.js';
import type { CrudApi, CrudListParams, CrudReferenceCount, CrudRow } from './crud-api.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'name', label: 'Customer', logicalType: 'varchar', nullable: false, isDisplay: true, maxLength: 120 }),
  spec({ name: 'email', label: 'Email', logicalType: 'varchar', semantic: 'email', unique: true, nullable: false, maxLength: 200 }),
  spec({
    name: 'status',
    label: 'Status',
    logicalType: 'enum',
    semantic: 'status-workflow',
    enumValues: ['active', 'trialing'],
    enumTones: { active: 'pos', trialing: 'warn' },
    nullable: false,
  }),
  spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money', nullable: false }),
];

const REFERENCES: CrudReferenceCount[] = [
  { relationId: 'rel_orders', table: 'public.orders', column: 'customer_id', count: 3 },
];

function makeApi(rows: CrudRow[]): CrudApi {
  return {
    list: vi.fn(async (params: CrudListParams) => {
      if (params.offset !== undefined) {
        // count probe (offset mode carries the total)
        return { data: rows.slice(0, 1), page: { limit: params.limit ?? 1, offset: 0, total: 8402 } };
      }
      return { data: rows, cursor: { next: null } };
    }),
    get: vi.fn(async (recordId: string) => ({
      data: rows.find((row) => String(row['id']) === recordId) ?? (rows[0] as CrudRow),
      inboundCounts: REFERENCES,
    })),
    create: vi.fn(async (values: CrudRow) => ({ data: { id: 99, ...values }, undoToken: 'undo_create' })),
    update: vi.fn(async () => ({ data: null, undoToken: 'undo_update' })),
    remove: vi.fn(async (_recordId: string, options?: { dryRun?: boolean | undefined; confirm?: boolean | undefined }) => {
      if (options?.dryRun === true) return { references: REFERENCES, requiresConfirm: true };
      return { data: null, undoToken: 'undo_delete' };
    }),
    references: vi.fn(async () => REFERENCES),
    undo: vi.fn(async () => ({ restoredIds: [1] })),
  };
}

const rows: CrudRow[] = [
  { id: 1, name: 'Initech', email: 'it@initech.io', status: 'trialing', mrr: '980' },
  { id: 2, name: 'Stark Industries', email: 'billing@stark.com', status: 'active', mrr: '6100' },
];

function renderPage(api: CrudApi, extra: Partial<Parameters<typeof PageCrud>[0]> = {}) {
  return render(
    <PageCrud
      api={api}
      columns={columns}
      source={{ connectionId: 'conn_1', table: 'public.customers' }}
      {...extra}
    />,
  );
}

describe('PageCrud template (09 §7.1)', () => {
  it('lists rows through the CrudApi with type-aware cells + keyset footer', async () => {
    const api = makeApi(rows);
    renderPage(api);
    expect(await screen.findByText('Initech')).toBeDefined();
    expect(screen.getByText('$980')).toBeDefined(); // money from pg string
    // count probe feeds the footer total
    expect(await screen.findByText('1–2 of 8,402')).toBeDefined();
    // DB framing on the header CTA
    expect(screen.getByRole('button', { name: /New row/ })).toBeDefined();
  });

  it('server sort resets keyset paging and reissues the list query', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);
    await screen.findByText('Initech');
    await user.click(screen.getByRole('button', { name: 'Sort by MRR' }));
    await waitFor(() => {
      const calls = (api.list as ReturnType<typeof vi.fn>).mock.calls as [CrudListParams][];
      const sorted = calls.find(([params]) => params.order !== undefined);
      expect(sorted?.[0].order).toEqual([{ column: 'mrr', dir: 'asc' }]);
      expect(sorted?.[0].cursor).toBe('');
    });
  });

  it('create flow: TwoPhaseModal domain framing, generated form, undo toast', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);
    await screen.findByText('Initech');

    await user.click(screen.getByRole('button', { name: /New row/ }));
    // domain framing in the modal (vs "New row" in the header)
    expect(await screen.findByRole('heading', { name: 'Add customer' })).toBeDefined();

    const dialog = screen.getByRole('dialog');
    // enum arity 2 + required → SegmentedControl (radiogroup of segments)
    expect(within(dialog).getByRole('radiogroup')).toBeDefined();
    // unique column shows the live-count microcopy (09 §7.1)
    expect(await within(dialog).findByText('Checked against 8,402 rows.')).toBeDefined();

    await user.type(within(dialog).getByRole('textbox', { name: /Customer/ }), 'Acme Holdings');
    await user.type(within(dialog).getByRole('textbox', { name: /Email/ }), 'ops@acme.dev');
    await user.click(within(dialog).getByRole('radio', { name: /active/ }));
    await user.type(within(dialog).getByRole('spinbutton', { name: /MRR/ }), '1200');
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }));

    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({
        name: 'Acme Holdings',
        email: 'ops@acme.dev',
        status: 'active',
        mrr: 1200,
      });
    });
    // success phase echoes the harvested payload; undo toast fires
    expect(await screen.findByText('Acme Holdings added')).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeDefined();
  });

  it('delete flow: references preflight renders consequences and gates on type-to-confirm', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);

    // open the detail panel via row click
    await user.click(await screen.findByText('Initech'));
    const detailDialog = await screen.findByRole('dialog');
    await within(detailDialog).findByText('Fields');

    await user.click(within(detailDialog).getByRole('button', { name: 'Delete' }));

    // preflight ran as a dry run — no write
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith('1', { dryRun: true });
    });
    // consequence list from the server counts
    expect(await screen.findByText('public.orders.customer_id')).toBeDefined();
    expect(screen.getByText('3 rows')).toBeDefined();

    // the confirm modal is the dialog carrying the type-to-confirm input
    const confirmInput = document.querySelector('[data-part="confirm-input"]') as HTMLInputElement;
    const confirmDialog = confirmInput.closest('[role="dialog"]') as HTMLElement;
    const confirmButton = within(confirmDialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;

    // danger button is gated until the key-field value is typed exactly
    expect(confirmButton.disabled).toBe(true);
    await user.type(confirmInput, 'Initech');
    expect(confirmButton.disabled).toBe(false);

    await user.click(confirmButton);
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith('1', { confirm: true });
    });

    // undo toast on the mutation; consuming it hits the undo endpoint
    const undoButton = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undoButton);
    await waitFor(() => {
      expect(api.undo).toHaveBeenCalledWith('undo_delete');
    });
  });

  it('selection morphs the toolbar into bulk actions', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);
    await screen.findByText('Initech');
    expect(screen.getByPlaceholderText(/Search public\.customers/)).toBeDefined();

    const bodyRows = screen.getAllByRole('row').slice(1);
    await user.click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));

    // search is replaced by the bulk bar (09 §7.1 "toolbar morphs")
    expect(screen.queryByPlaceholderText(/Search public\.customers/)).toBeNull();
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('1')).toBeDefined();
    expect(within(toolbar).getByText('Delete')).toBeDefined();
  });

  it('empty result set with a search shows the no-matches state', async () => {
    const api = makeApi([]);
    renderPage(api);
    expect(await screen.findByText('No customers yet')).toBeDefined();
  });

  it('list errors surface with a Retry that reissues the query', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    (api.list as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockRejectedValueOnce(new Error('connection lost')); // count probe
    renderPage(api);
    expect(await screen.findByText('Query failed')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Initech')).toBeDefined();
  });
});

describe('page-crud localization (ui:templates.crud.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              templates: {
                crud: {
                  newRow: 'Neue Zeile',
                  // ICU args must flow through the provider path too.
                  emptyTitle: '{count, plural, other {Noch keine {entity}}}',
                },
              },
            }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <PageCrud
          api={makeApi([])}
          columns={columns}
          source={{ connectionId: 'conn_1', table: 'public.customers' }}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText('Noch keine customer')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Neue Zeile' }).length).toBeGreaterThan(0);

    cleanup();
    render(
      <PageCrud
        api={makeApi([])}
        columns={columns}
        source={{ connectionId: 'conn_1', table: 'public.customers' }}
      />,
    );
    expect(await screen.findByText('No customers yet')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'New row' }).length).toBeGreaterThan(0);
  });
});
