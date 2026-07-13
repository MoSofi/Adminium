import type { Meta, StoryObj } from '@storybook/react-vite';

import { ProgressBar } from './ProgressBar.js';

const TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;

const meta = {
  title: 'Tier1/ProgressBar',
  component: ProgressBar,
  args: { value: 64, max: 100, tone: 'accent', size: 'md', animated: true, label: 'Upload progress' },
  argTypes: {
    tone: { control: 'select', options: TONES },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-72 flex-col gap-3">
      <ProgressBar size="sm" value={35} animated={false} label="35 percent" />
      <ProgressBar size="md" value={64} animated={false} label="64 percent" />
      <ProgressBar size="lg" value={90} animated={false} label="90 percent" />
      <ProgressBar value={0} animated={false} label="0 percent" />
      <ProgressBar value={100} animated={false} label="100 percent" />
      <ProgressBar value={340} max={512} animated={false} label="340 of 512" />
    </div>
  ),
};

export const TonesMatrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-72 flex-col gap-3">
      {TONES.map((tone) => (
        <ProgressBar key={tone} tone={tone} value={64} animated={false} label={`${tone} progress`} />
      ))}
    </div>
  ),
};
