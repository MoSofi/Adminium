// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BulkActionToolbar } from './BulkActionToolbar.js';
import { DataGrid } from './DataGrid.js';
import { gridColumnSpecSchema } from './column-spec.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';

const columns: GridColumnSpec[] = [
  { name: 'id', label: 'ID', primaryKey: true, logicalType: 'integer', hidden: true },
  { name: 'name', label: 'Customer', logicalType: 'varchar', isDisplay: true },
  { name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money' },
].map((input) => gridColumnSpecSchema.parse(input));

// pg-serialized decimals — STRINGS (the defect input shape).
const rows: GridRow[] = [
  { id: 1, name: 'Initech', mrr: '980' },
  { id: 2, name: 'Stark', mrr: '6100' },
  { id: 3, name: 'Umbrella', mrr: '290' },
  { id: 4, name: 'Globex', mrr: '1290' },
];

function moneyCellTexts(): string[] {
  return [...document.querySelectorAll('[role="row"] [data-column="mrr"]')].map(
    (cell) => cell.textContent ?? '',
  );
}

describe('DataGrid', () => {
  it('renders uppercase micro headers and type-aware cells', () => {
    render(<DataGrid columns={columns} rows={rows} />);
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByText('MRR')).toBeDefined();
    expect(screen.getByText('$980')).toBeDefined(); // money formatting from string
    // hidden column not rendered
    expect(screen.queryByText('ID')).toBeNull();
  });

  it('exposes body rows inside a rowgroup — the locator contract the E2E grids poll', () => {
    // Both Playwright suites wait on getByRole('rowgroup').getByRole('row')
    // for page-crud grids (apps/e2e/tests/helpers.ts, apps/e2e/tests-desktop/
    // helpers/flow.ts). The header row lives OUTSIDE the rowgroup by design,
    // so the rowgroup must contain exactly the data rows.
    render(<DataGrid columns={columns} rows={rows} />);
    const body = screen.getByRole('rowgroup');
    expect(within(body).getAllByRole('row')).toHaveLength(rows.length);
  });

  it('client sort: money column sorts NUMERICALLY over string values (mrr fix)', async () => {
    const user = userEvent.setup();
    render(<DataGrid columns={columns} rows={rows} />);
    await user.click(screen.getByRole('button', { name: 'Sort by MRR' }));
    expect(moneyCellTexts()).toEqual(['$290', '$980', '$1,290', '$6,100']);
    await user.click(screen.getByRole('button', { name: 'Sort by MRR' }));
    expect(moneyCellTexts()).toEqual(['$6,100', '$1,290', '$980', '$290']);
  });

  it('client sort survives a client-added string row mixed with numbers', async () => {
    const user = userEvent.setup();
    render(
      <DataGrid
        columns={columns}
        rows={[...rows, { id: 5, name: 'New Row', mrr: 45 }]} // number vs strings
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sort by MRR' }));
    expect(moneyCellTexts()[0]).toBe('$45');
  });

  it('server sort: onSortChange fires with column + dir and no local reorder', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(<DataGrid columns={columns} rows={rows} sort={null} onSortChange={onSortChange} />);
    await user.click(screen.getByRole('button', { name: 'Sort by MRR' }));
    expect(onSortChange).toHaveBeenCalledWith({ column: 'mrr', dir: 'asc' });
    // manual mode: rows stay in server order until the host reissues the query
    expect(moneyCellTexts()).toEqual(['$980', '$6,100', '$290', '$1,290']);
  });

  it('aria-sort reflects the controlled sort', () => {
    render(<DataGrid columns={columns} rows={rows} sort={{ column: 'mrr', dir: 'desc' }} onSortChange={() => {}} />);
    const header = screen.getAllByRole('columnheader').find((el) => el.textContent?.includes('MRR'));
    expect(header?.getAttribute('aria-sort')).toBe('descending');
  });

  it('row click opens the record; checkbox selection stays independent', async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    const onSelectedChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        selectable
        selected={new Set()}
        onSelectedChange={onSelectedChange}
        onRowOpen={onRowOpen}
      />,
    );
    await user.click(screen.getByText('Initech'));
    expect(onRowOpen).toHaveBeenCalledWith(rows[0]);

    const firstRow = screen.getAllByRole('row')[1] as HTMLElement; // 0 = header
    await user.click(within(firstRow).getByRole('checkbox', { name: 'Select row' }));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set(['1']));
    expect(onRowOpen).toHaveBeenCalledTimes(1); // checkbox click must not open
  });

  it('select-all header checkbox selects every row id', async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(
      <DataGrid columns={columns} rows={rows} selectable selected={new Set()} onSelectedChange={onSelectedChange} />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set(['1', '2', '3', '4']));
  });
});

describe('selection → bulk-action-toolbar wiring', () => {
  function Harness() {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    return (
      <div>
        <BulkActionToolbar
          selectedIds={[...selected]}
          actions={[{ key: 'delete', label: 'Delete', danger: true }]}
          onAction={() => {}}
          onClear={() => setSelected(new Set())}
        />
        <DataGrid columns={columns} rows={rows} selectable selected={selected} onSelectedChange={setSelected} />
      </div>
    );
  }

  it('appears with the mono count once rows are selected, clears back', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('toolbar')).toBeNull();

    const bodyRows = screen.getAllByRole('row').slice(1);
    await user.click(within(bodyRows[0] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));
    await user.click(within(bodyRows[1] as HTMLElement).getByRole('checkbox', { name: 'Select row' }));

    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('2')).toBeDefined();
    expect(within(toolbar).getByText('Delete')).toBeDefined();

    await user.click(within(toolbar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
