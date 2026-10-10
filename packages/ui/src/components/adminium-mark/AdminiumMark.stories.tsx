// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AdminiumMark } from './AdminiumMark.js';

const meta = {
  title: 'Tier1/AdminiumMark',
  component: AdminiumMark,
} satisfies Meta<typeof AdminiumMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { className: 'size-8 text-accent' } };

export const OnATile: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <span className="flex size-7 items-center justify-center rounded-[8px] bg-accent text-accent-fg">
        <AdminiumMark />
      </span>
      <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-accent text-accent-fg">
        <AdminiumMark className="size-[17px]" />
      </span>
      <AdminiumMark className="size-8 text-accent" title="Adminium" />
    </div>
  ),
};
