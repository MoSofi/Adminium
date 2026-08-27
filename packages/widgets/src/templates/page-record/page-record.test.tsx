// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageRecord } from './PageRecord.js';
import type { PageRecordProps, PageRecordRelated, RecordActivityFeed } from './PageRecord.js';
import type { CrudApi, CrudReferenceCount, CrudRow } from '../page-crud/crud-api.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'number', label: 'Number', logicalType: 'varchar', nullable: false, isDisplay: true }),
  spec({ name: 'status', label: 'Status', logicalType: 'enum', semantic: 'status-workflow', enumValues: ['paid', 'draft'], enumTones: { paid: 'pos', draft: 'muted' }, nullable: false }),
  spec({ name: 'email', label: 'Email', logicalType: 'varchar', semantic: 'email', pii: true }),
  spec({ name: 'total', label: 'Total', logicalType: 'decimal', semantic: 'money' }),
];

const RECORD: CrudRow = {
  id: 7,
  number: 'INV-1007',
  status: 'paid',
  email: null,
  total: '412.50',
  _masked: ['email'],
};

const REFERENCES: CrudReferenceCount[] = [
  { relationId: 'rel_items', table: 'public.invoice_items', column: 'invoice_id', count: 3 },
];

const RELATED_ROWS: CrudRow[] = [
  { item_id: 21, invoice_id: 7, description: 'Design retainer', amount: '250' },
  { item_id: 22, invoice_id: 7, description: 'Hosting', amount: '162.50' },
];

const relatedColumns = [
  spec({ name: 'item_id', label: 'Item', logicalType: 'integer', primaryKey: true }),
  spec({ name: 'description', label: 'Description', logicalType: 'varchar', isDisplay: true }),
  spec({ name: 'amount', label: 'Amount', logicalType: 'decimal', semantic: 'money' }),
];

function makeApi(): CrudApi {
  return {
    list: vi.fn(async () => ({ data: [RECORD], cursor: { next: null } })),
    get: vi.fn(async () => ({ data: RECORD, inboundCounts: REFERENCES })),
    create: vi.fn(async () => ({ data: null, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: 'undo_update' })),
    remove: vi.fn(async (_recordId: string, options?: { dryRun?: boolean | undefined; confirm?: boolean | undefined }) => {
      if (options?.dryRun === true) return { references: REFERENCES, requiresConfirm: true };
      return { data: null, undoToken: 'undo_delete' };
    }),
    references: vi.fn(async () => REFERENCES),
    undo: vi.fn(async () => ({ restoredIds: [7] })),
  };
}

function makeRelated(overrides: Partial<PageRecordRelated> = {}): PageRecordRelated {
  return {
    list: vi.fn(async () => ({ data: RELATED_ROWS, cursor: { next: null } })),
    resolve: vi.fn(async () => ({
      columns: relatedColumns,
      defaultSort: { column: 'item_id', dir: 'desc' as const },
    })),
    linkable: vi.fn(() => true),
    ...overrides,
  };
}

const TABS = [{ table: 'public.invoice_items', fkColumn: 'invoice_id', label: 'Invoice items' }];

function renderRecord(api: CrudApi, extra: Partial<PageRecordProps> = {}) {
  return render(
    <PageRecord
      api={api}
      columns={columns}
      source={{ connectionId: 'conn_1', table: 'public.invoices' }}
      recordId="7"
      keyField="number"
      tabs={TABS}
      {...extra}
    />,
  );
}

describe('PageRecord', () => {
  it('renders the key-field hero, status meta, and the field grid (D4)', async () => {
    renderRecord(makeApi(), { related: makeRelated() });
    // Hero = keyField value; the entity noun + record id sit under it.
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('INV-1007');
    expect(screen.getByText('invoice')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
    // Field grid renders every visible column's label; hidden PK stays out.
    const fields = document.querySelector('[data-part="record-fields"]') as HTMLElement;
    expect(within(fields).getByText('Number')).toBeDefined();
    expect(within(fields).getByText('Total')).toBeDefined();
    expect(within(fields).queryByText('ID')).toBeNull();
    // The masked column renders the masked treatment, exactly as the grid
    // would (D7): the row's _masked marker drives it.
    expect(fields.querySelector('[data-part="cell-masked"]')).not.toBeNull();
  });

  it('falls back to the display value when keyField is absent', async () => {
    renderRecord(makeApi(), { keyField: null, related: makeRelated() });
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('INV-1007');
  });

  it('renders the keyField value even when the list cap dropped its column spec', async () => {
    // Generation's ~8-column cap routinely excludes the display column (a
    // free-text company name) from `config.columns` while still naming it in
    // `keyField` — the hero reads the RECORD, not the specs.
    const api = makeApi();
    api.get = vi.fn(async () => ({
      data: { ...RECORD, company: 'Drift & Fern' },
      inboundCounts: REFERENCES,
    }));
    renderRecord(api, { keyField: 'company', related: makeRelated() });
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Drift & Fern');
  });

  it('related tab: real grid rows via the fk filter, count pill as total (D4/D5)', async () => {
    const related = makeRelated();
    renderRecord(makeApi(), { related });

    // The tab is count-pilled from referenceCounts and its grid loads with
    // the fk equality filter + the related table's own default sort.
    expect(await screen.findByRole('tab', { name: /Invoice items/ })).toBeDefined();
    await screen.findByText('Design retainer');
    expect(related.list).toHaveBeenCalledWith(
      'public.invoice_items',
      expect.objectContaining({
        where: { column: 'invoice_id', op: 'eq', value: 7 },
        order: [{ column: 'item_id', dir: 'desc' }],
      }),
    );
  });

  it('related rows emit record-open with the TARGET table when linkable (D5)', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    renderRecord(makeApi(), { related: makeRelated(), onEvent });
    await user.click(await screen.findByText('Design retainer'));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'record-open',
      connectionId: 'conn_1',
      table: 'public.invoice_items',
      recordId: '21',
    });
  });

  it('related rows stay un-linked when the table has no page (D5 degradation)', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    renderRecord(makeApi(), {
      related: makeRelated({
        resolve: vi.fn(async () => null),
        linkable: vi.fn(() => false),
      }),
      onEvent,
    });
    // Derived columns render the raw keys; clicking a row emits nothing.
    await user.click(await screen.findByText('Design retainer'));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('readOnly: no Edit, no Delete, anywhere (D7)', async () => {
    renderRecord(makeApi(), { readOnly: true, related: makeRelated() });
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('the Activity tab is ABSENT without a feed, present with one (D6)', async () => {
    const { unmount } = renderRecord(makeApi(), { related: makeRelated() });
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
    unmount();

    const user = userEvent.setup();
    const feed: RecordActivityFeed = {
      list: vi.fn(async () => ({
        entries: [
          { id: 'aud_1', actorLabel: 'Ava Reyes', action: 'record.update', at: 1_750_000_000_000, changedFields: 2 },
        ],
        nextCursor: null,
      })),
    };
    renderRecord(makeApi(), { related: makeRelated(), activity: feed });
    await user.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('Ava Reyes updated this record')).toBeDefined();
    expect(screen.getByText('2 fields changed')).toBeDefined();
  });

  it('activity empty state says "No activity recorded", never "nothing happened" (D6)', async () => {
    const user = userEvent.setup();
    const feed: RecordActivityFeed = { list: vi.fn(async () => ({ entries: [], nextCursor: null })) };
    renderRecord(makeApi(), { related: makeRelated(), activity: feed });
    await user.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('No activity recorded')).toBeDefined();
  });

  it('edit saves through the existing RecordForm flow and refetches', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    renderRecord(api, { related: makeRelated() });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Save changes' });
    await user.click(submit);
    await waitFor(() => {
      expect(api.update).toHaveBeenCalled();
    });
    expect(await screen.findByText('Changes saved.')).toBeDefined();
    // The page refetches the record so the new values render.
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('delete: preflight consequences, type-to-confirm, then onDeleted(undoToken)', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const onDeleted = vi.fn();
    renderRecord(api, { related: makeRelated(), onDeleted });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith('7', { dryRun: true });
    });
    expect(await screen.findByText('public.invoice_items.invoice_id')).toBeDefined();

    const confirmInput = document.querySelector('[data-part="confirm-input"]') as HTMLInputElement;
    const confirmDialog = confirmInput.closest('[role="dialog"]') as HTMLElement;
    const confirmButton = within(confirmDialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await user.type(confirmInput, 'INV-1007');
    await user.click(confirmButton);

    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith('7', { confirm: true });
    });
    // The host navigates and owns the undo toast (30 §3.2).
    expect(onDeleted).toHaveBeenCalledWith('undo_delete');
  });

  it('a 404 reports onMissing instead of rendering an error card', async () => {
    const api = makeApi();
    api.get = vi.fn(async () => {
      throw Object.assign(new Error('Not found'), { status: 404 });
    });
    const onMissing = vi.fn();
    renderRecord(api, { related: makeRelated(), onMissing });
    await waitFor(() => {
      expect(onMissing).toHaveBeenCalled();
    });
    expect(screen.queryByText('Failed to load the record.')).toBeNull();
  });
});

describe('in-tab create (30 follow-up — "Add item")', () => {
  const fkSpec = spec({
    name: 'invoice_id',
    label: 'Invoice',
    logicalType: 'integer',
    nullable: false,
    fk: { table: 'public.invoices', column: 'id' },
  });

  function makeChildApi(): CrudApi {
    const child = makeApi();
    child.create = vi.fn(async () => ({ data: null, undoToken: null }));
    return child;
  }

  function creatableRelated(childApi: CrudApi, overrides: Partial<PageRecordRelated> = {}): PageRecordRelated {
    return makeRelated({
      resolve: vi.fn(async () => ({
        columns: [...relatedColumns, fkSpec],
        defaultSort: null,
        canCreate: true,
      })),
      api: vi.fn(() => childApi),
      ...overrides,
    });
  }

  it('creates a child born attached: FK injected at submit, never rendered as a field', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const childApi = makeChildApi();
    const related = creatableRelated(childApi);
    renderRecord(api, { related });

    await user.click(await screen.findByRole('button', { name: 'New row' }));
    // The implied FK is not a choice — "add to THIS invoice" must not invite
    // picking another one: the form renders every other column, never the FK.
    const form = document.getElementById('page-record-add-public.invoice_items') as HTMLElement;
    expect(form).not.toBeNull();
    expect(within(form).queryByLabelText(/Invoice$/)).toBeNull();
    await user.type(within(form).getByLabelText(/Description/), 'Follow-up sprint');
    await user.click(screen.getByRole('button', { name: 'Add invoice item' }));

    await waitFor(() => {
      expect(childApi.create).toHaveBeenCalledTimes(1);
    });
    expect(childApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Follow-up sprint', invoice_id: 7 }),
    );
    // The tab refetches its rows and the parent reloads (fresh count pills).
    await waitFor(() => {
      expect(related.list).toHaveBeenCalledTimes(2);
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  it('offers nothing without the capability, without the api, or on a readOnly page (D7)', async () => {
    // canCreate absent (an older host, or a viewer's target page) → no button.
    const absent = renderRecord(makeApi(), {
      related: makeRelated({ api: vi.fn(() => makeChildApi()) }),
    });
    await screen.findByText('Design retainer');
    expect(screen.queryByRole('button', { name: 'New row' })).toBeNull();
    absent.unmount();

    // Capability present but the PARENT page is readOnly → no write
    // affordance anywhere, tabs included.
    const readOnly = renderRecord(makeApi(), {
      related: creatableRelated(makeChildApi()),
      readOnly: true,
    });
    await screen.findByText('Design retainer');
    expect(screen.queryByRole('button', { name: 'New row' })).toBeNull();
    readOnly.unmount();

    // Capability present but no write api wired → read-only tab, as before.
    renderRecord(makeApi(), {
      related: makeRelated({
        resolve: vi.fn(async () => ({ columns: relatedColumns, defaultSort: null, canCreate: true })),
      }),
    });
    await screen.findByText('Design retainer');
    expect(screen.queryByRole('button', { name: 'New row' })).toBeNull();
  });

  it('the empty tab offers the same door — the first child starts here', async () => {
    const related = creatableRelated(makeChildApi(), {
      list: vi.fn(async () => ({ data: [], cursor: { next: null } })),
    });
    renderRecord(makeApi(), { related });
    expect(await screen.findByText('No related records')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New row' })).toBeDefined();
  });
});
