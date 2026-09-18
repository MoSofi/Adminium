// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quick-create's inline field (147–180, 609–610): the two drawn states, set and
 * unset, which are the whole affordance.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, Flag, Hash, User } from 'lucide-react';

import { MetaPill } from './MetaPill.js';

const meta: Meta<typeof MetaPill> = {
  title: 'Tier2/MetaPill',
  component: MetaPill,
  args: { placeholder: 'Due date', icon: <CalendarDays className="size-[13px]" /> },
};
export default meta;

type Story = StoryObj<typeof MetaPill>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-wrap gap-2">
      <MetaPill icon={<CalendarDays className="size-[13px]" />} placeholder="Due date" />
      <MetaPill icon={<CalendarDays className="size-[13px]" />} placeholder="Due date" value="Tomorrow" />
      <MetaPill icon={<Flag className="size-[13px]" />} placeholder="Priority" value="High" />
      <MetaPill icon={<User className="size-[13px]" />} placeholder="Assignee" />
      <MetaPill icon={<Hash className="size-[13px]" />} placeholder="Project" value="Northwind" />
    </div>
  ),
};
