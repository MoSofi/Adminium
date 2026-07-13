import type { Meta, StoryObj } from '@storybook/react-vite';

import { Divider } from './Divider.js';

const meta = {
  title: 'Tier1/Divider',
  component: Divider,
  args: { orientation: 'horizontal' },
  argTypes: { orientation: { control: 'select', options: ['horizontal', 'vertical'] } },
} satisfies Meta<typeof Divider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-72 flex-col gap-4 text-body text-fg">
      <p>Above the rule</p>
      <Divider />
      <p>Below the rule</p>
      <Divider label="or" />
      <div className="flex h-8 items-center gap-3">
        <span>Start</span>
        <Divider orientation="vertical" />
        <span>End</span>
      </div>
    </div>
  ),
};
