// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayoutGrid, List, Table } from 'lucide-react';

import { SegmentedControl } from './SegmentedControl.js';

const meta = {
  title: 'Tier2/SegmentedControl',
  component: SegmentedControl,
  args: {
    options: [
      { value: 'all', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'archived', label: 'Archived' },
    ],
    disabled: false,
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <SegmentedControl aria-label="Filter" {...args} />,
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <SegmentedControl
        aria-label="Text"
        defaultValue="week"
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
      <SegmentedControl
        aria-label="Icon only"
        defaultValue="grid"
        options={[
          { value: 'list', icon: <List />, ariaLabel: 'List view' },
          { value: 'grid', icon: <LayoutGrid />, ariaLabel: 'Grid view' },
          { value: 'table', icon: <Table />, ariaLabel: 'Table view' },
        ]}
      />
      <SegmentedControl
        aria-label="With counts"
        defaultValue="open"
        options={[
          { value: 'open', label: 'Open', count: 12 },
          { value: 'closed', label: 'Closed', count: 340 },
          { value: 'draft', label: 'Draft', count: 2, disabled: true },
        ]}
      />
      <SegmentedControl
        aria-label="With status dots"
        defaultValue="prod"
        options={[
          { value: 'prod', label: 'Production', dot: 'pos' },
          { value: 'staging', label: 'Staging', dot: 'warn' },
          { value: 'dev', label: 'Dev', dot: 'neutral' },
        ]}
      />
      <SegmentedControl
        aria-label="Disabled tray"
        disabled
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />
    </div>
  ),
};
