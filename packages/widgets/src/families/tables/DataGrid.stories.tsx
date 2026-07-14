import { useState } from 'react';

import { BulkActionToolbar } from './BulkActionToolbar.js';
import { DataGrid } from './DataGrid.js';
import type { DataGridSort } from './DataGrid.js';
import { DetailKeyValue } from './DetailKeyValue.js';
import { MiniTable } from './MiniTable.js';
import { PaginationFooter } from './PaginationFooter.js';
import { demoCustomerColumns, demoCustomerRows } from './demo-data.js';

/**
 * `tables` family stories (M4-T03 acceptance: data-grid states + attached
 * widgets on demo data). Loosely typed — the 04-T17 QA harness wires widgets
 * stories into the workspace Storybook.
 */
const meta = {
  title: 'Widgets/Tables/DataGrid',
  component: DataGrid,
};
export default meta;

const rows = demoCustomerRows(7);

export const TypeAwareCells = {
  render: () => (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <DataGrid columns={demoCustomerColumns} rows={rows} cellContext={{ canUnmask: true }} />
    </div>
  ),
};

export const ClientSortedNumeric = {
  name: 'Client sort (string-mrr fix)',
  render: () => (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* mrr values are pg-serialized STRINGS — sorting stays numeric */}
      <DataGrid columns={demoCustomerColumns} rows={rows} sort={{ column: 'mrr', dir: 'desc' }} />
    </div>
  ),
};

export const SelectionAndBulkBar = {
  render: function SelectionStory() {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['1', '3']));
    return (
      <div className="flex flex-col gap-3">
        <BulkActionToolbar
          selectedIds={[...selected]}
          actions={[
            { key: 'export', label: 'Export' },
            { key: 'delete', label: 'Delete', danger: true },
          ]}
          onAction={() => {}}
          onClear={() => setSelected(new Set())}
        />
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <DataGrid
            columns={demoCustomerColumns}
            rows={rows}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
          />
        </div>
      </div>
    );
  },
};

export const ServerSortWithFooter = {
  render: function ServerSortStory() {
    const [sort, setSort] = useState<DataGridSort | null>({ column: 'created_at', dir: 'desc' });
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <DataGrid columns={demoCustomerColumns} rows={rows} sort={sort} onSortChange={setSort} />
        <PaginationFooter
          rangeStart={1}
          rangeEnd={rows.length}
          total={8402}
          hasPrev={false}
          hasNext
          onPrev={() => {}}
          onNext={() => {}}
          pageSize={25}
          onPageSizeChange={() => {}}
        />
      </div>
    );
  },
};

export const CompactDensity = {
  render: () => (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <DataGrid columns={demoCustomerColumns} rows={rows} density="compact" />
    </div>
  ),
};

export const DetailAndMini = {
  name: 'DetailKeyValue + MiniTable',
  render: () => (
    <div className="grid max-w-4xl grid-cols-2 gap-4">
      <DetailKeyValue columns={demoCustomerColumns} record={rows[0] ?? {}} showTypeTags />
      <div className="rounded-lg border border-border bg-surface">
        <MiniTable
          columns={demoCustomerColumns.filter((c) => ['name', 'status', 'mrr'].includes(c.name))}
          rows={rows}
          limit={5}
          viewAllHref="/p/customers"
        />
      </div>
    </div>
  ),
};
