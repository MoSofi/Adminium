// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageCrud } from './PageCrud.js';
import type {
  CrudApi,
  CrudExportRequest,
  CrudExportTicket,
  CrudListParams,
  CrudReferenceCount,
  CrudRow,
} from './crud-api.js';
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

  it('selection morphs only the toolbar end slot into bulk actions', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);
    await screen.findByText('Initech');
    expect(screen.getByPlaceholderText(/Search public\.customers/)).toBeDefined();
    expect(screen.getByRole('button', { name: /New row/ })).toBeDefined();

    const bodyRows = screen.getAllByRole('row').slice(1);
    await user.click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));

    // The bulk bar takes the CTA's slot (09 §7.1 "toolbar morphs") — and ONLY
    // that slot. Search and the filter chips survive the selection: they are
    // how the user built the set they are now acting on, so hiding them mid-
    // task was the defect this asserts against.
    expect(screen.getByPlaceholderText(/Search public\.customers/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /New row/ })).toBeNull();
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

/**
 * The bulk Export button. It was declared in the selection bar's action list
 * while `onAction` branched on `'delete'` only — a visible, enabled, entirely
 * dead control. These pin both live paths (queued server run when the host
 * implements `CrudApi.export`, browser-side serialization of the selection when
 * it does not) so it cannot regress to decoration.
 */
describe('page-crud bulk Export (09 §11.2)', () => {
  /** Collect anchors the download helper creates, ignoring anything React renders. */
  function captureDownloads() {
    const anchors: HTMLAnchorElement[] = [];
    const blobs: Blob[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === 'a') {
        (node as HTMLAnchorElement).click = vi.fn(() => {
          if ((node as HTMLAnchorElement).download !== '') anchors.push(node as HTMLAnchorElement);
        });
      }
      return node;
    });
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:fake';
    });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    return { anchors, blobs };
  }

  async function selectFirstRowAndExport(user: ReturnType<typeof userEvent.setup>) {
    const bodyRows = screen.getAllByRole('row').slice(1);
    await user.click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    const button = within(toolbar).getByText('Export');
    await user.click(button);
  }

  it('offers Export in the selection bar alongside Delete', async () => {
    const user = userEvent.setup();
    renderPage(makeApi(rows));
    await screen.findByText('Initech');
    const bodyRows = screen.getAllByRole('row').slice(1);
    await user.click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('Export')).toBeDefined();
  });

  it('queues the server-side export run when the host implements CrudApi.export', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    const exportFn = vi.fn(async (request: CrudExportRequest): Promise<CrudExportTicket> => ({
      id: `exp_${request.format}`,
      status: 'processing',
    }));
    renderPage({ ...api, export: exportFn });
    await screen.findByText('Initech');

    await selectFirstRowAndExport(user);

    await waitFor(() => {
      expect(exportFn).toHaveBeenCalledOnce();
    });
    const request = exportFn.mock.calls[0]?.[0] as CrudExportRequest;
    // csv, never xlsx — POST /exports rejects xlsx with a 422 by design.
    expect(request.format).toBe('csv');
    expect(request.ids).toEqual(['1']);
    // The grid's live query rides along, so a whole-result run matches the screen.
    expect(request.params).toBeDefined();

    // Nothing visible happens on the queued path (the artifact lands on the
    // Data exports page), so the toast is the only feedback there is.
    expect(await screen.findByText('Preparing your export…')).toBeDefined();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serializes the selected rows in the browser when the host has no export endpoint', async () => {
    const user = userEvent.setup();
    renderPage(makeApi(rows));
    await screen.findByText('Initech');
    const { anchors, blobs } = captureDownloads();

    await selectFirstRowAndExport(user);

    await waitFor(() => {
      expect(blobs.length).toBeGreaterThan(0);
    });
    const text = await (blobs[0] as Blob).text();
    // Only the SELECTED row, projected onto the grid's columns.
    expect(text).toContain('Initech');
    expect(text).not.toContain('Stark Industries');
    expect(text.split('\r\n')[0]).toContain('name');
    expect((blobs[0] as Blob).type).toContain('text/csv');
    expect(anchors[0]?.getAttribute('download')).toMatch(/^public\.customers-\d{8}-\d{4}\.csv$/);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the selection after an export — it is not a destructive action', async () => {
    const user = userEvent.setup();
    renderPage(makeApi(rows));
    await screen.findByText('Initech');
    captureDownloads();

    await selectFirstRowAndExport(user);

    // The bulk bar is still up with the same count; the rows are usually still
    // wanted afterwards, unlike a bulk delete.
    const toolbar = await screen.findByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('1')).toBeDefined();
    expect(within(toolbar).getByText('Export')).toBeDefined();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('never opens the delete confirmation — Export and Delete are separate branches', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);
    await screen.findByText('Initech');
    captureDownloads();

    await selectFirstRowAndExport(user);

    await waitFor(() => {
      expect(document.querySelector('[data-part="confirm-input"]')).toBeNull();
    });
    expect(api.remove).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * The selection deliberately survives paging, so an export has to as well.
   * The browser fallback used to filter the CURRENTLY LOADED page by the
   * selected ids, which meant everything selected on an earlier page fell out
   * of the file with nothing on screen to say so.
   */
  it('exports rows selected on an earlier page, not just the loaded one', async () => {
    const user = userEvent.setup();
    const pageTwo: CrudRow[] = [
      { id: 3, name: 'Wonka Industries', email: 'ops@wonka.example', status: 'active', mrr: '4200' },
      { id: 4, name: 'Cyberdyne', email: 'ar@cyberdyne.example', status: 'active', mrr: '7300' },
    ];
    const api: CrudApi = {
      ...makeApi(rows),
      list: vi.fn(async (params: CrudListParams) => {
        if (params.offset !== undefined) {
          return { data: rows.slice(0, 1), page: { limit: params.limit ?? 1, offset: 0, total: 4 } };
        }
        return params.cursor === 'page-2'
          ? { data: pageTwo, cursor: { next: null } }
          : { data: rows, cursor: { next: 'page-2' } };
      }),
    };
    renderPage(api);
    await screen.findByText('Initech');
    const { blobs } = captureDownloads();

    // Page one: select Initech. The count is awaited rather than asserted
    // synchronously — this file runs alongside 83 others under one CPU budget,
    // and a sync read here is a load-sensitive flake, not a stricter test.
    const firstPage = screen.getAllByRole('row').slice(1);
    await user.click(within(firstPage[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    await within(await screen.findByRole('toolbar', { name: 'Bulk actions' })).findByText('1');

    // Page two: select Wonka. Initech is no longer rendered anywhere.
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Wonka Industries');
    expect(screen.queryByText('Initech')).toBeNull();
    const secondPage = screen.getAllByRole('row').slice(1);
    await user.click(within(secondPage[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));

    // Two rows selected, one of them no longer on screen — the whole point.
    const toolbar = await screen.findByRole('toolbar', { name: 'Bulk actions' });
    await within(toolbar).findByText('2');
    await user.click(within(toolbar).getByText('Export'));

    await waitFor(() => {
      expect(blobs.length).toBeGreaterThan(0);
    });
    const text = await (blobs[0] as Blob).text();
    expect(text).toContain('Initech');
    expect(text).toContain('Wonka Industries');
    // …and still only what was selected.
    expect(text).not.toContain('Stark Industries');
    expect(text).not.toContain('Cyberdyne');
    // Nothing was dropped, so nothing warns about a short file.
    expect(screen.queryByText(/selected rows/)).toBeNull();

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('drops a deleted row from the selection, so the export cannot carry it', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage(api);
    await screen.findByText('Initech');

    const bodyRows = screen.getAllByRole('row').slice(1);
    await user.click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    await user.click(within(bodyRows[1] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    await within(await screen.findByRole('toolbar', { name: 'Bulk actions' })).findByText('2');

    // Delete the first one through its own row action, not through the bulk bar.
    await user.click(screen.getByText('Initech'));
    const detailDialog = await screen.findByRole('dialog');
    await within(detailDialog).findByText('Fields');
    await user.click(within(detailDialog).getByRole('button', { name: 'Delete' }));
    const confirmInput = (await waitFor(() => {
      const input = document.querySelector('[data-part="confirm-input"]');
      expect(input).not.toBeNull();
      return input;
    })) as HTMLInputElement;
    const confirmDialog = confirmInput.closest('[role="dialog"]') as HTMLElement;
    await user.type(confirmInput, 'Initech');
    await user.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    // One left selected, and it is the one that still exists.
    const toolbar = await screen.findByRole('toolbar', { name: 'Bulk actions' });
    await within(toolbar).findByText('1');
  });

  it('drops a row from the snapshot when it is deselected', async () => {
    const user = userEvent.setup();
    renderPage(makeApi(rows));
    await screen.findByText('Initech');
    const { blobs } = captureDownloads();

    const bodyRows = screen.getAllByRole('row').slice(1);
    const first = within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' });
    await user.click(first);
    await user.click(within(bodyRows[1] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    await user.click(first);

    const toolbar = await screen.findByRole('toolbar', { name: 'Bulk actions' });
    await within(toolbar).findByText('1');
    await user.click(within(toolbar).getByText('Export'));

    await waitFor(() => {
      expect(blobs.length).toBeGreaterThan(0);
    });
    const text = await (blobs[0] as Blob).text();
    expect(text).toContain('Stark Industries');
    expect(text).not.toContain('Initech');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('surfaces a failed export as an error toast rather than an unhandled rejection', async () => {
    const user = userEvent.setup();
    const api = makeApi(rows);
    renderPage({ ...api, export: vi.fn(async () => { throw new Error('Export quota exceeded'); }) });
    await screen.findByText('Initech');

    await selectFirstRowAndExport(user);

    expect(await screen.findByText('Export quota exceeded')).toBeDefined();
  });
});
