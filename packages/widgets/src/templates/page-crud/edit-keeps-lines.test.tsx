// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * An edit keeps the lines a record has.
 *
 * A save sends every line-items field the form holds, and the server makes the
 * record's lines exactly those: a line left out is removed. So a read of the
 * lines that failed (a dropped connection, a 500) must not stand in as "no
 * lines" — the field is left out of the form and out of the save, and the
 * record keeps its lines. Both pages that edit a row are pinned here.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { parseCrudForm, type FormColumnFact } from '../../page-config/index.js';
import { PageRecord } from '../page-record/PageRecord.js';
import { PageCrud } from './PageCrud.js';
import type { CrudApi } from './crud-api.js';
import type { ChildFacts } from './RecordForm.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const ROW = { id: 1, name: 'Acme' };

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', nullable: false, isDisplay: true, maxLength: 120 }),
];

const FORM_COLUMNS: FormColumnFact[] = columns.map((column, ordinal) => ({
  spec: column as unknown as FormColumnFact['spec'],
  ordinal,
  writable: true,
  filledBy: column.name === 'id' ? 'database' : null,
  required: column.name === 'name',
}));

const line = (relation: string, table: string): ChildFacts => ({
  label: relation,
  table,
  foreignColumn: 'invoice_id',
  parentKeyColumn: 'id',
  primaryKey: ['id'],
  columns: [
    spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true }),
    spec({ name: 'item', label: 'Item', logicalType: 'varchar' }),
  ],
});

const CHILD_FACTS: Record<string, ChildFacts> = {
  rel_lines: line('Lines', 'public.lines'),
  rel_notes: line('Notes', 'public.notes'),
};

const FORM = parseCrudForm({
  form: {
    v: 2,
    sections: [
      {
        id: 'main',
        fields: [
          { column: 'name' },
          { relation: 'rel_lines', control: 'child-rows', label: 'Lines', columns: [{ column: 'item' }] },
          { relation: 'rel_notes', control: 'child-rows', label: 'Notes', columns: [{ column: 'item' }] },
        ],
      },
    ],
  },
});

/** The lines read; the notes' read fails as a dropped connection does. */
function makeApi() {
  return {
    list: vi.fn(async () => ({ data: [ROW], cursor: { next: null } })),
    get: vi.fn(async () => ({ data: ROW, inboundCounts: [] })),
    create: vi.fn(async () => ({ data: null, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [1] })),
    listRelated: vi.fn(async ({ table }: { table: string }) => {
      if (table === 'public.notes') throw new Error('Failed to fetch');
      return [{ id: 41, invoice_id: 1, item: 'Anvil' }];
    }),
  };
}

/** What the save made each line-items field hold. */
function savedChildren(api: ReturnType<typeof makeApi>): Record<string, unknown[]> | undefined {
  return (api.update.mock.calls[0] as unknown[] | undefined)?.[3] as Record<string, unknown[]> | undefined;
}

async function saveAndCheck(user: ReturnType<typeof userEvent.setup>, api: ReturnType<typeof makeApi>) {
  const dialog = await screen.findByRole('dialog', { name: /edit/i });
  await waitFor(() => expect(within(dialog).getAllByTestId('child-row')).toHaveLength(1));
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
  const children = savedChildren(api);
  expect(children?.['rel_lines']).toEqual([{ key: { id: 41 }, values: expect.objectContaining({ item: 'Anvil' }) }]);
  // The notes could not be read: the save says nothing of them, so the record keeps them.
  expect(children).not.toHaveProperty('rel_notes');
}

describe('an edit keeps the record’s lines when one read of them fails', () => {
  it('on the list', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(
      <PageCrud
        api={api as unknown as CrudApi}
        columns={columns}
        formColumns={FORM_COLUMNS}
        form={FORM}
        childFacts={CHILD_FACTS}
        source={{ connectionId: 'conn_1', table: 'public.invoices' }}
      />,
    );
    await user.click((await screen.findAllByRole('button', { name: 'Peek' }))[0]!);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await saveAndCheck(user, api);
  });

  it('on the record page', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(
      <PageRecord
        api={api as unknown as CrudApi}
        columns={columns}
        formColumns={FORM_COLUMNS}
        form={FORM}
        childFacts={CHILD_FACTS}
        source={{ connectionId: 'conn_1', table: 'public.invoices' }}
        recordId="1"
        keyField="name"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await saveAndCheck(user, api);
  });
});
