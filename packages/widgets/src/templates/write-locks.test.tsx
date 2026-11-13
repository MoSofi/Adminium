// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The templates under the write locks (`lib/write-lock.tsx`): every create,
 * edit and delete control a page draws stays in reach, says `aria-disabled`
 * and gives the reason; a database's lock leaves its deletes open.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../families/tables/column-spec.js';
import { setDatabaseWriteLock, setWriteLock } from '../lib/write-lock.js';
import type { CrudApi, CrudRow } from './page-crud/crud-api.js';
import { PageBoard } from './page-board/PageBoard.js';
import { PageCalendar } from './page-calendar/PageCalendar.js';
import { PageCrud } from './page-crud/PageCrud.js';
import { PageRecord, type PageRecordRelated, type RecordAttachment } from './page-record/PageRecord.js';

const ENDED = 'Read-only: this trial has ended';
const CAPPED = 'Read-only: the database is over the trial’s limit';

afterEach(() => {
  act(() => {
    setWriteLock(null);
    setDatabaseWriteLock('conn_1', null);
  });
});

const columns = [
  gridColumnSpecSchema.parse({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  gridColumnSpecSchema.parse({ name: 'name', label: 'Customer', logicalType: 'varchar', nullable: false, isDisplay: true }),
];
const rows: CrudRow[] = [
  { id: 1, name: 'Initech' },
  { id: 2, name: 'Stark Industries' },
];

function crudApi(): CrudApi {
  return {
    list: vi.fn(async () => ({ data: rows, cursor: { next: null } })),
    get: vi.fn(async () => ({ data: rows[0] as CrudRow, inboundCounts: [] })),
    create: vi.fn(async (values: CrudRow) => ({ data: { id: 99, ...values }, undoToken: 'u' })),
    update: vi.fn(async () => ({ data: null, undoToken: 'u' })),
    remove: vi.fn(async () => ({ data: null, undoToken: 'u' })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [] })),
  } as unknown as CrudApi;
}

async function selectFirstRow(): Promise<HTMLElement> {
  await screen.findByText('Initech');
  const bodyRows = screen.getAllByRole('row').slice(1);
  await userEvent.setup().click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
  return screen.getByRole('toolbar', { name: 'Bulk actions' });
}

describe('a table page under the locks', () => {
  it('keeps the bulk Delete in reach with the reason once the trial has ended, and runs nothing', async () => {
    const run = vi.fn();
    act(() => setWriteLock(ENDED));
    render(
      <PageCrud
        api={crudApi()}
        columns={columns}
        source={{ connectionId: 'conn_1', table: 'public.customers' }}
        bulkActions={[{ key: 'invoice', label: 'Make invoices', write: 'create', run }]}
      />,
    );
    const toolbar = await selectFirstRow();
    const remove = within(toolbar).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    const invoice = within(toolbar).getByRole('button', { name: 'Make invoices' });
    expect(invoice.getAttribute('aria-disabled')).toBe('true');
    const user = userEvent.setup();
    await user.click(remove);
    await user.click(invoice);
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => remove.focus());
    expect((await screen.findAllByText(ENDED)).length).toBeGreaterThan(0);
  });

  it('keeps the bulk Delete open while only the database is held, and locks New row', async () => {
    act(() => setDatabaseWriteLock('conn_1', CAPPED));
    render(<PageCrud api={crudApi()} columns={columns} source={{ connectionId: 'conn_1', table: 'public.customers' }} />);
    await screen.findByText('Initech');
    expect(screen.getByRole('button', { name: /New row/ }).getAttribute('aria-disabled')).toBe('true');
    const toolbar = await selectFirstRow();
    expect(within(toolbar).getByRole('button', { name: 'Delete' }).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('a record page under the locks', () => {
  const recordColumns = [
    gridColumnSpecSchema.parse({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
    gridColumnSpecSchema.parse({ name: 'number', label: 'Number', logicalType: 'varchar', nullable: false, isDisplay: true }),
  ];
  const record = { id: 7, number: 'INV-1007' };
  const itemColumns = [
    gridColumnSpecSchema.parse({ name: 'item_id', label: 'Item', logicalType: 'integer', primaryKey: true }),
    gridColumnSpecSchema.parse({ name: 'description', label: 'Description', logicalType: 'varchar', isDisplay: true }),
    gridColumnSpecSchema.parse({ name: 'invoice_id', label: 'Invoice', logicalType: 'integer', nullable: false, fk: { table: 'public.invoices', column: 'id' } }),
  ];
  const file: RecordAttachment = {
    id: 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD',
    filename: 'contract.pdf',
    mime: 'application/pdf',
    sizeBytes: 4096,
    createdAt: 1_750_000_000_000,
    contentPath: '/api/v1/files/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD/content',
  };

  function recordApi(): CrudApi {
    return { ...crudApi(), get: vi.fn(async () => ({ data: record, inboundCounts: [] })) } as unknown as CrudApi;
  }

  function related(): PageRecordRelated {
    return {
      list: vi.fn(async () => ({ data: [{ item_id: 21, description: 'Hosting', invoice_id: 7 }], cursor: { next: null } })),
      resolve: vi.fn(async () => ({ columns: itemColumns, defaultSort: null, canCreate: true })),
      linkable: vi.fn(() => true),
      api: vi.fn(() => crudApi()),
    } as unknown as PageRecordRelated;
  }

  function renderRecord(extra: Partial<Parameters<typeof PageRecord>[0]> = {}) {
    return render(
      <PageRecord
        api={recordApi()}
        columns={recordColumns}
        source={{ connectionId: 'conn_1', table: 'public.invoices' }}
        recordId="7"
        keyField="number"
        tabs={[{ table: 'public.invoice_items', fkColumn: 'invoice_id', label: 'Invoice items' }]}
        {...extra}
      />,
    );
  }

  it('locks the related tab’s New row with the reason, under either lock', async () => {
    act(() => setWriteLock(ENDED));
    const { unmount } = renderRecord({ related: related() });
    const add = await screen.findByRole('button', { name: 'New row' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    await userEvent.setup().click(add);
    expect(document.getElementById('page-record-add-public.invoice_items')).toBeNull();
    unmount();
    act(() => {
      setWriteLock(null);
      setDatabaseWriteLock('conn_1', CAPPED);
    });
    renderRecord({ related: related() });
    expect((await screen.findByRole('button', { name: 'New row' })).getAttribute('aria-disabled')).toBe('true');
  });

  it('locks the attachments’ upload and Delete once the trial has ended', async () => {
    const attachments = { list: vi.fn().mockResolvedValue([file]), upload: vi.fn(), remove: vi.fn() };
    act(() => setWriteLock(ENDED));
    renderRecord({ attachments, canAttach: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /files/i }));
    await screen.findByText('contract.pdf');
    const panel = document.querySelector('[data-part="record-attachments"]') as HTMLElement;
    const drop = panel.querySelector('[data-part="dropzone"]') as HTMLButtonElement;
    expect(drop.getAttribute('aria-disabled')).toBe('true');
    expect(drop.disabled).toBe(false);
    await user.upload(panel.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'scan.pdf', { type: 'application/pdf' }));
    expect(attachments.upload).not.toHaveBeenCalled();
    const remove = panel.querySelector('[data-part="attachment-delete"]') as HTMLButtonElement;
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    await user.click(remove);
    expect(attachments.remove).not.toHaveBeenCalled();
    expect(within(panel).getByText('contract.pdf')).toBeDefined();
    act(() => remove.focus());
    expect((await screen.findAllByText(ENDED)).length).toBeGreaterThan(0);
  });

  it('leaves the attachments open while only the database is held: they are this installation’s own files', async () => {
    const attachments = { list: vi.fn().mockResolvedValue([file]), upload: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) };
    act(() => setDatabaseWriteLock('conn_1', CAPPED));
    renderRecord({ attachments, canAttach: true });
    await userEvent.setup().click(await screen.findByRole('tab', { name: /files/i }));
    await screen.findByText('contract.pdf');
    const panel = document.querySelector('[data-part="record-attachments"]') as HTMLElement;
    expect(panel.querySelector('[data-part="dropzone"]')?.getAttribute('aria-disabled')).toBeNull();
    expect(panel.querySelector('[data-part="attachment-delete"]')?.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('a board under the locks', () => {
  const binding = { kind: 'table-query', connectionId: 'conn_1', source: { schema: 'public', name: 'tasks', type: 'table' }, shape: 'record-list', limit: 200 };
  const KANBAN = { title: 'Tasks', statusColumn: 'status', titleColumn: 'title', columns: ['todo', 'done'], allowAdd: true, binding };
  const board = (config: Record<string, unknown>, widget = 'kanban-board', extra: unknown[] = []) => ({
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: { version: 1, items: [{ i: 'board-1', widget, x: 0, y: 0, w: 12, h: 16, config }, ...extra] },
  });
  const states = { 'board-1': { status: 'success' as const, data: { rows: [{ id: 'T-1', title: 'Fix login', status: 'todo', team: 'growth' }], columns: [], total: 1 } } };

  /** The writes a board asked for; opening a card is a read, and stays. */
  const writes = (onEvent: ReturnType<typeof vi.fn>) => onEvent.mock.calls.filter((call) => (call[1] as { type: string }).type === 'mutate');

  function keyboardMove(title: string): void {
    const card = screen.getByRole('button', { name: title });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    fireEvent.keyDown(card, { key: 'Enter' });
  }

  it.each([
    ['the trial has ended', () => setWriteLock(ENDED), ENDED],
    ['its database is held', () => setDatabaseWriteLock('conn_1', CAPPED), CAPPED],
  ])('locks adding and moving cards once %s', async (_when, lock, reason) => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    act(lock);
    render(<PageBoard config={board(KANBAN, 'kanban-board', [{ i: 'compose-1', widget: 'inline-compose-card', x: 0, y: 16, w: 4, h: 4, config: {} }])} states={states} onEvent={onEvent} />);
    const add = document.querySelector('[data-board-column="todo"] [data-part="column-add"]') as HTMLButtonElement;
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(document.querySelector('[data-part="column-composer"]')).toBeNull();
    const newCard = screen.getByTestId('board-new');
    expect(newCard.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(newCard);
    expect(document.querySelector('[data-part="column-composer"]')).toBeNull();
    const composer = screen.getByTestId('compose-slot-compose-1');
    expect(composer.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(composer);
    expect(screen.queryByRole('textbox')).toBeNull();
    keyboardMove('Fix login');
    expect(writes(onEvent)).toEqual([]);
    act(() => add.focus());
    expect((await screen.findAllByText(reason)).length).toBeGreaterThan(0);
  });

  it('moves no card across a swimlane once the trial has ended', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    act(() => setWriteLock(ENDED));
    render(<PageBoard config={board({ ...KANBAN, laneColumn: 'team' }, 'kanban-swimlane-grid')} states={states} onEvent={onEvent} />);
    keyboardMove('Fix login');
    expect(writes(onEvent)).toEqual([]);
  });

  it('leaves another database’s board open', () => {
    act(() => setDatabaseWriteLock('conn_2', CAPPED));
    render(<PageBoard config={board(KANBAN)} states={states} onEvent={vi.fn(() => Promise.resolve({}))} />);
    expect(screen.getByTestId('board-new').getAttribute('aria-disabled')).toBeNull();
    act(() => setDatabaseWriteLock('conn_2', null));
  });
});

describe('a calendar under the locks', () => {
  const CAL = { title: 'Visits', startColumn: 'starts_at', titleColumn: 'title', binding: { kind: 'table-query', connectionId: 'conn_1', source: { schema: 'public', name: 'visits', type: 'table' }, shape: 'calendar-events', limit: 500 } };
  const page = {
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: {
      version: 1,
      items: [
        { i: 'cal-1', widget: 'calendar-month', x: 0, y: 0, w: 8, h: 12, config: CAL },
        { i: 'agenda-1', widget: 'day-agenda', x: 8, y: 0, w: 4, h: 12, config: { ...CAL, title: 'Agenda' } },
      ],
    },
  };
  const states = { 'cal-1': { status: 'success' as const, data: { rows: [], columns: [{ name: 'starts_at', logicalType: 'timestamptz' }], total: 0 } } };

  it('locks New event, Add event and a click on an empty day once the trial has ended', async () => {
    const onCreate = vi.fn();
    act(() => setWriteLock(ENDED));
    render(<PageCalendar config={page} states={states} referenceDate="2026-09-24" timeZone="UTC" locale="en-US" onEvent={vi.fn()} onCreate={onCreate} />);
    const make = document.querySelector('[data-part="calendar-new"]') as HTMLButtonElement;
    expect(make.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(make);
    const agenda = screen.getByTestId('agenda-compose-open');
    expect(agenda.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(agenda);
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-09-28' }));
    expect(onCreate).not.toHaveBeenCalled();
    act(() => make.focus());
    expect((await screen.findAllByText(ENDED)).length).toBeGreaterThan(0);
  });

  it('locks the title composer while its database is held', () => {
    const onEvent = vi.fn();
    act(() => setDatabaseWriteLock('conn_1', CAPPED));
    render(<PageCalendar config={page} states={states} referenceDate="2026-09-24" timeZone="UTC" locale="en-US" onEvent={onEvent} />);
    const open = screen.getByTestId('agenda-compose');
    expect(open.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(open);
    expect(screen.queryByPlaceholderText('Event title…')).toBeNull();
  });
});
