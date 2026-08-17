// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Slider } from './Slider.js';

const meta = {
  title: 'Tier2/Slider',
  component: Slider,
  args: { defaultValue: [40], min: 0, max: 100, step: 1, disabled: false },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="w-[320px]">
      <Slider thumbLabels={['Value']} {...args} />
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[320px] flex-col gap-5">
      <Slider defaultValue={[40]} thumbLabels={['Single']} />
      <Slider defaultValue={[20, 65]} thumbLabels={['Range start', 'Range end']} />
      <Slider defaultValue={[70]} step={10} thumbLabels={['Stepped']} />
      <Slider defaultValue={[30]} disabled thumbLabels={['Disabled']} />
    </div>
  ),
};
