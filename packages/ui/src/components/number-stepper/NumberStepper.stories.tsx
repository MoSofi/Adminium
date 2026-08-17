// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { NumberStepper } from './NumberStepper.js';

const meta = {
  title: 'Tier2/NumberStepper',
  component: NumberStepper,
  args: {
    defaultValue: 3,
    min: 0,
    max: 10,
    step: 1,
    incrementLabel: 'Increase',
    decrementLabel: 'Decrease',
    // real usage wires the name via FormField/htmlFor; standalone needs one
    'aria-label': 'Quantity',
  },
} satisfies Meta<typeof NumberStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: (args) => (
    <div className="flex w-[200px] flex-col gap-3">
      <NumberStepper {...args} />
      <NumberStepper {...args} defaultValue={10} />
      <NumberStepper {...args} defaultValue={0} />
      <NumberStepper {...args} step={0.5} defaultValue={2.5} />
      <NumberStepper {...args} error />
      <NumberStepper {...args} disabled />
    </div>
  ),
};
