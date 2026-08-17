// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { DeltaPill } from './DeltaPill.js';

const meta = {
  title: 'Tier1/DeltaPill',
  component: DeltaPill,
  args: { trend: 'up', children: '+12.4%', invertGood: false },
  argTypes: {
    trend: { control: 'select', options: ['up', 'down', 'flat'] },
    tone: { control: 'select', options: ['pos', 'danger', 'muted'] },
    invertGood: { control: 'boolean' },
  },
} satisfies Meta<typeof DeltaPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <DeltaPill trend="up">+12.4%</DeltaPill>
        <DeltaPill trend="down">-3.1%</DeltaPill>
        <DeltaPill trend="flat">0.0%</DeltaPill>
      </div>
      <div className="flex items-center gap-2">
        <DeltaPill trend="up" invertGood>
          +8.9%
        </DeltaPill>
        <DeltaPill trend="down" invertGood>
          -8.9%
        </DeltaPill>
        <DeltaPill trend="up" tone="muted">
          +0.2%
        </DeltaPill>
      </div>
    </div>
  ),
};
