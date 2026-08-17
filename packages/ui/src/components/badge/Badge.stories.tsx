// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './Badge.js';
import type { Tone } from './Badge.js';

const TONES: Tone[] = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'];

const meta = {
  title: 'Tier1/Badge',
  component: Badge,
  args: { children: 'Badge', tone: 'neutral', dot: false },
  argTypes: {
    tone: { control: 'select', options: TONES },
    dot: { control: 'boolean' },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone} dot>
            {tone}
          </Badge>
        ))}
      </div>
    </div>
  ),
};

export const TonesMatrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="pos" dot>
        Paid
      </Badge>
      <Badge tone="warn" dot>
        Pending
      </Badge>
      <Badge tone="danger" dot>
        Failed
      </Badge>
      <Badge tone="info" dot>
        Refunded
      </Badge>
      <Badge tone="accent">Beta</Badge>
      <Badge tone="neutral">Draft</Badge>
    </div>
  ),
};
