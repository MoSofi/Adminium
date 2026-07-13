import type { Meta, StoryObj } from '@storybook/react-vite';

import { CountBadge } from './CountBadge.js';

const meta = {
  title: 'Tier1/CountBadge',
  component: CountBadge,
  args: { children: '12', active: false },
  argTypes: { active: { control: 'boolean' } },
} satisfies Meta<typeof CountBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex items-center gap-2">
      <CountBadge>3</CountBadge>
      <CountBadge>12</CountBadge>
      <CountBadge>248</CountBadge>
      <CountBadge active>3</CountBadge>
      <CountBadge active>99+</CountBadge>
      <span className="inline-flex items-center gap-1.5 text-body text-fg">
        Inbox <CountBadge active>7</CountBadge>
      </span>
    </div>
  ),
};
