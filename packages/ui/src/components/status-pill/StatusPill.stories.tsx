import type { Meta, StoryObj } from '@storybook/react-vite';

import { DEFAULT_STATUS_TONES, StatusPill } from './StatusPill.js';

const meta = {
  title: 'Tier1/StatusPill',
  component: StatusPill,
  args: { status: 'paid', children: 'Paid' },
  argTypes: {
    status: { control: 'select', options: Object.keys(DEFAULT_STATUS_TONES) },
    tone: { control: 'select', options: ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] },
  },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex max-w-form flex-wrap items-center gap-2">
      {Object.keys(DEFAULT_STATUS_TONES).map((status) => (
        <StatusPill key={status} status={status} />
      ))}
      <StatusPill status="custom_status">Unknown → neutral</StatusPill>
      <StatusPill status="draft" tone="accent">
        Override → accent
      </StatusPill>
    </div>
  ),
};
