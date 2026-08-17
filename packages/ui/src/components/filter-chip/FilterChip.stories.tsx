// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { AddFilterChip, FilterChip } from './FilterChip.js';

const meta = {
  title: 'Tier3/FilterChip',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const [filters, setFilters] = useState([
    { id: 'f1', field: 'status', op: '=', value: 'paid' },
    { id: 'f2', field: 'amount', op: '≥', value: '$1,000' },
    { id: 'f3', field: 'customer', op: 'contains', value: 'acme' },
  ]);
  return (
    <div className="flex flex-wrap items-center gap-2 p-6">
      {filters.map((f) => (
        <FilterChip
          key={f.id}
          field={f.field}
          op={f.op}
          value={f.value}
          removeLabel={`Remove ${f.field} filter`}
          onRemove={() => setFilters((prev) => prev.filter((x) => x.id !== f.id))}
        />
      ))}
      <AddFilterChip label="Add filter" onClick={() => {}} />
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };

export const Static: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <FilterChip field="status" op="=" value="paid" onRemove={() => {}} removeLabel="Remove" />
      <FilterChip field="amount" op="≥" value="$1,000" onRemove={() => {}} removeLabel="Remove" />
      <FilterChip field="created" op="within" value="30d" />
      <AddFilterChip label="Add filter" />
    </div>
  ),
};
