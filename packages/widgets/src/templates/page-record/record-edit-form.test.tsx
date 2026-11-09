// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The record page's Edit dialog draws the form the list's edit draws for the
 * same row: the page's designed form (its fields, their order) and a choice
 * column's values in the reader's words. It drew the flat stack of columns,
 * with a proof's state as `superseded` where the app calls it "Sent again".
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageRecord } from './PageRecord.js';
import type { PageRecordProps } from './PageRecord.js';
import type { CrudApi, CrudRow } from '../page-crud/crud-api.js';
import type { ColumnFacts } from '../page-crud/field-mapping.js';
import type { ChildFacts } from '../page-crud/RecordForm.js';
import { parseCrudForm, type FormColumnFact } from '../../page-config/index.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'title', label: 'Title', logicalType: 'varchar', nullable: false, isDisplay: true }),
  spec({ name: 'kind', label: 'Kind', logicalType: 'enum', enumValues: ['lettering', 'design'] }),
  spec({ name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['sent', 'approved', 'superseded'], nullable: false }),
  spec({ name: 'note', label: 'Note', logicalType: 'text' }),
];

const RECORD: CrudRow = { id: 3, title: 'Shop sign', kind: 'lettering', status: 'superseded', note: null };

const FACTS: ColumnFacts = {
  id: { filledBy: 'database', required: false, writable: true },
  title: { filledBy: null, required: true, writable: true },
  kind: { filledBy: null, required: false, writable: true, enumLabels: { lettering: 'Lettering', design: 'A design' } },
  status: {
    filledBy: null,
    required: true,
    writable: true,
    enumLabels: { sent: 'Sent', approved: 'Approved', superseded: 'Sent again' },
  },
  note: { filledBy: null, required: false, writable: true },
};

/** The table's columns as the page reply has them. */
const FORM_COLUMNS: FormColumnFact[] = COLUMNS.map((column, ordinal) => ({
  spec: column as unknown as FormColumnFact['spec'],
  ordinal,
  writable: true,
  filledBy: column.name === 'id' ? 'database' : null,
  required: column.name === 'title' || column.name === 'status',
}));

/** The form the app designed: the state first, then the title, the kind; no note. */
const DESIGNED = parseCrudForm({
  form: {
    v: 2,
    sections: [{ id: 'main', fields: [{ column: 'status' }, { column: 'title' }, { column: 'kind' }] }],
  },
});

function makeApi(over: Partial<CrudApi> = {}): CrudApi {
  return {
    ...over,
    list: vi.fn(async () => ({ data: [RECORD], cursor: { next: null } })),
    get: vi.fn(async () => ({ data: RECORD, inboundCounts: [] })),
    create: vi.fn(async () => ({ data: null, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [] })),
  };
}

async function openEdit(extra: Partial<PageRecordProps>, api: CrudApi = makeApi()) {
  const user = userEvent.setup();
  render(
    <PageRecord
      api={api}
      columns={COLUMNS}
      source={{ connectionId: 'conn_1', table: 'public.proofs' }}
      recordId="3"
      keyField="title"
      {...extra}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  return { dialog: await screen.findByRole('dialog'), user };
}

/** The dialog's field labels, top to bottom. */
function fieldLabels(dialog: HTMLElement): string[] {
  const names = ['Title', 'Kind', 'Status', 'Note'];
  return [...dialog.querySelectorAll('label, legend, [data-part="field-label"]')]
    .map((node) => node.textContent?.replace('*', '').trim() ?? '')
    .filter((text, index, all) => names.includes(text) && all.indexOf(text) === index);
}

describe("the record page's edit dialog", () => {
  it("offers a choice column's values in the reader's words, not the stored ones", async () => {
    const { dialog } = await openEdit({ fieldFacts: FACTS, formColumns: FORM_COLUMNS, form: null });
    expect(within(dialog).getAllByText('Sent again').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('A design').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('superseded')).toBeNull();
    expect(within(dialog).queryByText('lettering')).toBeNull();
  });

  it('draws the form the app designed: its fields, in its order', async () => {
    const { dialog } = await openEdit({ fieldFacts: FACTS, formColumns: FORM_COLUMNS, form: DESIGNED });
    expect(fieldLabels(dialog)).toEqual(['Status', 'Title', 'Kind']);
    // The note is left out of the designed form, so the dialog has no field for it.
    expect(within(dialog).queryByText('Note')).toBeNull();
    expect(within(dialog).getAllByText('Sent again').length).toBeGreaterThan(0);
  });

  it("offers only the moves the table's states allow from the record's state; the rest shown and not choosable", async () => {
    // A proof sent again can go nowhere: every other state is there, and none can be picked.
    const stateMoves = { column: 'status', initial: 'sent', moves: { sent: ['approved', { to: 'superseded' }], approved: [] as string[], superseded: [] as string[] } };
    const { dialog } = await openEdit({ fieldFacts: FACTS, formColumns: FORM_COLUMNS, form: DESIGNED, stateMoves });
    const state = (name: string) => within(dialog).getByRole('radio', { name }) as HTMLButtonElement;
    expect(state('Sent again').disabled).toBe(false);
    expect(state('Sent').disabled).toBe(true);
    expect(state('Approved').disabled).toBe(true);
    cleanup();

    // One still waiting may be approved or sent again; a move only the add-on that keeps the row makes is not offered.
    const waiting = makeApi();
    (waiting.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...RECORD, status: 'sent' }, inboundCounts: [] });
    const planned = { ...stateMoves, moves: { ...stateMoves.moves, sent: ['approved', { to: 'superseded', planned: true }] } };
    const again = await openEdit({ fieldFacts: FACTS, formColumns: FORM_COLUMNS, form: DESIGNED, stateMoves: planned }, waiting);
    const other = (name: string) => within(again.dialog).getByRole('radio', { name }) as HTMLButtonElement;
    expect(other('Sent').disabled).toBe(false);
    expect(other('Approved').disabled).toBe(false);
    expect(other('Sent again').disabled).toBe(true);
  });

  it('limits nothing when the table keeps no states', async () => {
    const { dialog } = await openEdit({ fieldFacts: FACTS, formColumns: FORM_COLUMNS, form: DESIGNED });
    for (const name of ['Sent', 'Approved', 'Sent again']) expect((within(dialog).getByRole('radio', { name }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reads the lines a line-items field holds, and saves them as the row’s children', async () => {
    const relation = 'rel_proof_marks';
    const childFacts: Record<string, ChildFacts> = {
      [relation]: {
        label: 'Marks',
        table: 'public.proof_marks',
        foreignColumn: 'proof_id',
        parentKeyColumn: 'id',
        primaryKey: ['id'],
        columns: [
          spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true }),
          spec({ name: 'mark', label: 'Mark', logicalType: 'varchar' }),
        ],
      },
    };
    const form = parseCrudForm({
      form: {
        v: 2,
        sections: [{ id: 'main', fields: [{ column: 'title' }, { relation, control: 'child-rows', label: 'Marks', columns: [{ column: 'mark' }] }] }],
      },
    });
    const listRelated = vi.fn(async () => [{ id: 41, proof_id: 3, mark: 'Kerning' }]);
    const api = makeApi({ listRelated });
    const { dialog, user } = await openEdit({ fieldFacts: FACTS, formColumns: FORM_COLUMNS, form, childFacts }, api);
    await waitFor(() => expect(within(dialog).getAllByTestId('child-row')).toHaveLength(1));
    expect(listRelated).toHaveBeenCalledWith({ table: 'public.proof_marks', column: 'proof_id', value: 3, limit: 1000 });
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const children = (api.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[3] as Record<string, unknown[]>;
    expect(children[relation]).toEqual([{ key: { id: 41 }, values: expect.objectContaining({ mark: 'Kerning' }) }]);
  });
});
