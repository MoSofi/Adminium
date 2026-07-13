import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from './Input.js';

const meta = {
  title: 'Tier2/Input',
  component: Input,
  args: { placeholder: 'jane@acme.io', mono: false, error: false, disabled: false },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[280px] flex-col gap-3">
      <Input placeholder="Workspace name" />
      <Input defaultValue="Acme Inc." />
      <Input mono defaultValue="pk_live_51Nc4aX8kQ" />
      <Input error defaultValue="not-an-email" />
      <Input disabled defaultValue="Read only plan" />
      <Input type="password" defaultValue="hunter2hunter2" />
    </div>
  ),
};
