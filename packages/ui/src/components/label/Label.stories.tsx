// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Eyebrow, Label } from './Label.js';

const meta = {
  title: 'Tier1/Label',
  component: Label,
  args: { children: 'Email address' },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-72 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="email-demo">Email address</Label>
        <input
          id="email-demo"
          readOnly
          value="ava@example.com"
          className="h-[34px] rounded-md border border-border-strong bg-surface-2 px-3 text-body text-fg"
        />
      </div>
      <Eyebrow>Workspace</Eyebrow>
      <Eyebrow className="text-accent">Active group</Eyebrow>
    </div>
  ),
};
