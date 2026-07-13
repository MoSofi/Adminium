import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton } from './Skeleton.js';

const meta = {
  title: 'Tier1/Skeleton',
  component: Skeleton,
  args: { width: 220, height: 14, rounded: 'md' },
  argTypes: { rounded: { control: 'select', options: ['sm', 'md', 'lg', 'full'] } },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div aria-busy="true" className="flex w-72 flex-col gap-3">
      <div className="flex items-center gap-3">
        <Skeleton rounded="full" width={32} height={32} />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton height={12} width="60%" />
          <Skeleton height={10} width="40%" />
        </div>
      </div>
      <Skeleton height={14} />
      <Skeleton height={14} width="85%" />
      <Skeleton rounded="lg" height={96} />
      <Skeleton rounded="sm" height={10} width={120} />
    </div>
  ),
};
