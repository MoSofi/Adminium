import type { Meta, StoryObj } from '@storybook/react-vite';

import { RuntimeChip } from './RuntimeChip.js';

const meta = {
  title: 'Tier1/RuntimeChip',
  component: RuntimeChip,
  args: { state: 'local', label: 'Local' },
  argTypes: {
    state: { control: 'select', options: ['local', 'lan-share', 'remote-db', 'remote-db-offline'] },
  },
} satisfies Meta<typeof RuntimeChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** 11-electron.md §8.1's four rows, with the labels that table specifies. */
export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex max-w-form flex-wrap items-center gap-2">
      <RuntimeChip state="local" label="Local" />
      <RuntimeChip state="lan-share" label="Local · Sharing on LAN" onClick={() => {}} />
      <RuntimeChip state="remote-db" label="Local + remote DB" />
      <RuntimeChip state="remote-db-offline" label="Remote DB offline" description="prod-db is unreachable" />
    </div>
  ),
};
