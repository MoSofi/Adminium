// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * An edit hands the host the row as the form loaded it, beside the change:
 * a host that knows the table's states names the state the person saw, so a
 * move the app lists as an undo is made from the records page too, and a row
 * another screen moved on since is refused rather than moved.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { PageCrud } from './PageCrud.js';
import type { CrudApi } from './crud-api.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const ROW = { id: 1, name: 'Acme', status: 'ready' };

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false, hidden: true }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', nullable: false, isDisplay: true, maxLength: 120 }),
  spec({ name: 'status', label: 'Status', logicalType: 'varchar', nullable: false, maxLength: 20 }),
];

function makeApi() {
  return {
    list: vi.fn(async () => ({ data: [ROW], cursor: { next: null } })),
    get: vi.fn(async () => ({ data: ROW, inboundCounts: [] })),
    create: vi.fn(async () => ({ data: null, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [1] })),
  };
}

describe('an edit on the records page', () => {
  it('hands the host the row as the form loaded it', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<PageCrud api={api as unknown as CrudApi} columns={columns} source={{ connectionId: 'conn_1', table: 'public.orders' }} />);
    await user.click((await screen.findAllByRole('button', { name: 'Peek' }))[0]!);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: /edit/i });
    const status = within(dialog).getByLabelText(/Status/);
    await user.clear(status);
    await user.type(status, 'preparing');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const [recordId, patch, , , seen] = api.update.mock.calls[0] as unknown as [string, Record<string, unknown>, unknown, unknown, unknown];
    expect(recordId).toBe('1');
    expect(patch).toEqual({ status: 'preparing' });
    expect(seen).toEqual(ROW);
  });
});
