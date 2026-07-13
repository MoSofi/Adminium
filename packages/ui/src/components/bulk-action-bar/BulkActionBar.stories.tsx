import type { Meta, StoryObj } from '@storybook/react-vite';
import { Archive, FileDown, Trash2 } from 'lucide-react';

import { BulkActionBar, BulkActionButton } from './BulkActionBar.js';

const meta = {
  title: 'Tier3/BulkActionBar',
  component: BulkActionBar,
} satisfies Meta<typeof BulkActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  tags: ['vrt'],
  args: { count: 3, countLabel: 'selected', clearLabel: 'Clear selection', onClear: () => {} },
  render: (args) => (
    <div className="p-6">
      <BulkActionBar {...args} floating={false} label="Bulk actions">
        <BulkActionButton icon={<FileDown />}>Export</BulkActionButton>
        <BulkActionButton icon={<Archive />}>Archive</BulkActionButton>
        <BulkActionButton icon={<Trash2 />} destructive>
          Delete
        </BulkActionButton>
      </BulkActionBar>
    </div>
  ),
};
