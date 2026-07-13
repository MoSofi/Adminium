import type { Meta, StoryObj } from '@storybook/react-vite';

import { Label } from '../label/index.js';
import { Switch } from './Switch.js';

const meta = {
  title: 'Tier2/Switch',
  component: Switch,
  args: { disabled: false },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="flex items-center gap-2.5">
      <Switch id="sw-playground" {...args} />
      <Label htmlFor="sw-playground">Require 2FA for all members</Label>
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex items-center gap-4">
      <Switch aria-label="Off" />
      <Switch aria-label="On" defaultChecked />
      <Switch aria-label="Disabled off" disabled />
      <Switch aria-label="Disabled on" disabled defaultChecked />
    </div>
  ),
};
