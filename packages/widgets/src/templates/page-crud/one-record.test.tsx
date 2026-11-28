// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE TABLE AS ONE RECORD — a settings page (`page-settings` bound to a table).
 *
 * An app's settings table holds one row, and a records page of it was a list
 * of one row the person had to open to edit. In one-record mode the page is
 * that row's form, with Save, and no list, search, New or Delete. With no row
 * yet the form makes the first one; with more than one it edits the first and
 * says the others are not read.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { PageCrud } from './PageCrud.js';
import type { CrudApi, CrudRow } from './crud-api.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'studio_name', label: 'Studio name', logicalType: 'varchar', nullable: false, isDisplay: true, maxLength: 120 }),
  spec({ name: 'about', label: 'About', logicalType: 'varchar', nullable: true, maxLength: 400 }),
];

function makeApi(rows: CrudRow[]) {
  let stored = rows;
  return {
    list: vi.fn(async () => ({ data: stored, cursor: { next: null } })),
    get: vi.fn(async () => ({ data: stored[0] ?? null, inboundCounts: [] })),
    create: vi.fn(async (values: CrudRow) => {
      stored = [{ id: 1, ...values }];
      return { data: stored[0], undoToken: null };
    }),
    update: vi.fn(async (_id: string, values: CrudRow) => {
      stored = [{ ...stored[0], ...values }];
      return { data: stored[0], undoToken: 'undo_1' };
    }),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [1] })),
  };
}

function page(api: ReturnType<typeof makeApi>, props: Partial<React.ComponentProps<typeof PageCrud>> = {}) {
  render(
    <PageCrud
      api={api as unknown as CrudApi}
      oneRecord
      columns={columns}
      source={{ connectionId: 'conn_1', table: 'public.maker_settings' }}
      {...props}
    />,
  );
}

describe('a settings page of a table', () => {
  it('opens on the row’s form, with no list, search, New or Delete', async () => {
    page(makeApi([{ id: 1, studio_name: 'Birch Row', about: 'Two of us.' }]));
    expect(((await screen.findByLabelText(/Studio name/)) as HTMLInputElement).value).toBe('Birch Row');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('button', { name: /New row/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    // The edit dialog of a records page never opens over it.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('saves what changed on that row, and shows it as saved', async () => {
    const api = makeApi([{ id: 1, studio_name: 'Birch Row', about: 'Two of us.' }]);
    page(api);
    const user = userEvent.setup();
    const name = await screen.findByLabelText(/Studio name/);
    await user.clear(name);
    await user.type(name, 'Fernlight Studio');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]?.[0]).toBe('1');
    expect(api.update.mock.calls[0]?.[1]).toEqual({ studio_name: 'Fernlight Studio' });
    expect(await screen.findByText('Changes saved.')).toBeTruthy();
    await waitFor(() => expect(((screen.getByLabelText(/Studio name/)) as HTMLInputElement).value).toBe('Fernlight Studio'));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('makes the first row when the table has none', async () => {
    const api = makeApi([]);
    page(api);
    const user = userEvent.setup();
    expect(await screen.findByText('Nothing is set yet. Fill these in and save.')).toBeTruthy();
    await user.type(screen.getByLabelText(/Studio name/), 'Fernlight');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[0]).toMatchObject({ studio_name: 'Fernlight' });
    // Read back: the page is now that row's form.
    await waitFor(() => expect(screen.queryByText('Nothing is set yet. Fill these in and save.')).toBeNull());
    expect(api.update).not.toHaveBeenCalled();
  });

  it('edits the first row and says the others are not read, when the table holds more', async () => {
    page(makeApi([{ id: 1, studio_name: 'Birch Row', about: null }, { id: 2, studio_name: 'Second', about: null }]));
    expect(((await screen.findByLabelText(/Studio name/)) as HTMLInputElement).value).toBe('Birch Row');
    expect(screen.getByText(/This table holds 1 more row\. Only the first is edited here/)).toBeTruthy();
  });

  it('shows the row, with no form, to a reader who may not change it', async () => {
    page(makeApi([{ id: 1, studio_name: 'Birch Row', about: null }]), { canUpdate: false });
    expect((await screen.findAllByText('Birch Row')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('says nothing is set, with no form, to a reader who may not fill it in', async () => {
    page(makeApi([]), { canCreate: false });
    expect(await screen.findByText('Nothing is set yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
