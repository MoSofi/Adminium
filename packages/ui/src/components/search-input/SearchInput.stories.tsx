import type { Meta, StoryObj } from '@storybook/react-vite';

import { SearchInput } from './SearchInput.js';

const meta = {
  title: 'Tier2/SearchInput',
  component: SearchInput,
  args: { placeholder: 'Search…' },
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[300px] flex-col gap-3">
      <SearchInput placeholder="Search…" />
      <SearchInput placeholder="Jump to…" kbd="⌘K" />
      <SearchInput defaultValue="churn" onClear={() => {}} clearLabel="Clear search" />
      <SearchInput placeholder="Search…" disabled />
    </div>
  ),
};
