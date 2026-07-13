import type { Meta, StoryObj } from '@storybook/react-vite';

import { Spinner } from './Spinner.js';

const meta = {
  title: 'Tier1/Spinner',
  component: Spinner,
  args: { size: 'sm', label: 'Loading' },
  argTypes: { size: { control: 'select', options: ['sm', 'md', 'lg'] } },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex items-center gap-4 text-accent">
      <Spinner size="sm" label="Loading sm" />
      <Spinner size="md" label="Loading md" />
      <Spinner size="lg" label="Loading lg" />
      <span className="text-fg-muted">
        <Spinner size="md" label="Muted" />
      </span>
      <span className="text-danger">
        <Spinner size="md" label="Danger" />
      </span>
    </div>
  ),
};
