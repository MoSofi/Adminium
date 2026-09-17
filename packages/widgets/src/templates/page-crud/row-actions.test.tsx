// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `PageCrudProps.rowActions` and `PageCrudProps.bulkActions`.
 *
 * Pass-throughs, so the only thing this component decides is WHERE an action
 * sits — and that decision is what is pinned: Peek stays rightmost, because it
 * is the row's own affordance and has been in that position since the grid
 * shipped, and Delete stays last in the bulk bar.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { PageCrud } from './PageCrud.js';
import type { CrudApi } from './crud-api.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const ROWS = [
  { id: 1, name: 'Acme' },
  { id: 2, name: 'Northwind' },
];

const columns = [
  spec({
    name: 'id',
    label: 'ID',
    logicalType: 'integer',
    primaryKey: true,
    hasDefault: true,
    nullable: false,
    hidden: true,
  }),
  spec({
    name: 'name',
    label: 'Name',
    logicalType: 'varchar',
    nullable: false,
    isDisplay: true,
    maxLength: 120,
  }),
];

function makeApi(): CrudApi {
  return {
    list: vi.fn(async () => ({ data: ROWS, cursor: { next: null } })),
    get: vi.fn(async () => ({ data: ROWS[0], inboundCounts: [] })),
    create: vi.fn(async () => ({ data: null, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [1] })),
  } as unknown as CrudApi;
}

function renderCrud(extra: Record<string, unknown> = {}) {
  return render(
    <PageCrud
      api={makeApi()}
      columns={columns}
      source={{ connectionId: 'conn_1', table: 'public.orders' }}
      {...extra}
    />,
  );
}

describe('row actions', () => {
  it('renders none when the host passes none — the row ends where it did', async () => {
    renderCrud();
    expect(await screen.findAllByRole('button', { name: 'Peek' })).toHaveLength(2);
    expect(screen.queryByTestId('row-doc-1')).toBeNull();
  });

  it('renders one per row, with the row handed to the callback', async () => {
    const seen: unknown[] = [];
    renderCrud({
      rowActions: (row: Record<string, unknown>) => {
        seen.push(row);
        return <button type="button" data-testid={`row-doc-${String(row.id)}`}>Make</button>;
      },
    });
    expect(await screen.findByTestId('row-doc-1')).not.toBeNull();
    expect(screen.getByTestId('row-doc-2')).not.toBeNull();
    // The ROW, not an id — the host decides which of its columns identifies a
    // record, and guessing between `id`, `ref`, `number` and `code` is the
    // same defect `RecordActionsPayload.recordId` exists to prevent.
    expect((seen[0] as { name: string }).name).toBe('Acme');
  });

  it('keeps Peek rightmost, after the host action', async () => {
    renderCrud({
      rowActions: (row: Record<string, unknown>) => (
        <button type="button" data-testid={`row-doc-${String(row.id)}`}>Make</button>
      ),
    });
    const action = await screen.findByTestId('row-doc-1');
    const peeks = screen.getAllByRole('button', { name: 'Peek' });
    expect(
      action.compareDocumentPosition(peeks[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('bulk actions', () => {
  async function selectBoth(): Promise<void> {
    await screen.findAllByRole('button', { name: 'Peek' });
    const boxes = screen.getAllByRole('checkbox');
    // The header box selects every row on the page.
    fireEvent.click(boxes[0]!);
  }

  it('adds none when the host passes none', async () => {
    renderCrud();
    await selectBoth();
    const bar = screen.getByRole('toolbar');
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).not.toContain('Refund');
  });

  it('places host actions between Export and Delete, and hands them the selected ids', async () => {
    const run = vi.fn();
    renderCrud({ bulkActions: [{ key: 'refund', label: 'Refund', run }] });
    await selectBoth();
    const bar = screen.getByRole('toolbar');
    const labels = within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    const at = (label: string) => labels.findIndex((text) => text.includes(label));
    expect(at('Export')).toBeLessThan(at('Refund'));
    expect(at('Refund')).toBeLessThan(at('Delete'));
    fireEvent.click(within(bar).getByRole('button', { name: 'Refund' }));
    expect(run).toHaveBeenCalledWith(['1', '2']);
  });
});
