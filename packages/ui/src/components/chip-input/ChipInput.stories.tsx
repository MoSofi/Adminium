// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChipInput } from './ChipInput.js';

const meta = {
  title: 'Tier2/ChipInput',
  component: ChipInput,
  args: {
    placeholder: 'Add emails…',
    removeLabel: (chip: string) => `Remove ${chip}`,
  },
} satisfies Meta<typeof ChipInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { defaultValue: ['ava@acme.io'] },
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: (args) => (
    <div className="flex w-[340px] flex-col gap-3">
      <ChipInput {...args} defaultValue={['ava@acme.io', 'omar@acme.io']} />
      <ChipInput {...args} placeholder="Allowed domains…" defaultValue={['acme.io', 'acme.dev']} />
      <ChipInput {...args} error defaultValue={['bad token']} />
      <ChipInput {...args} disabled defaultValue={['locked@acme.io']} />
    </div>
  ),
};

export const WithValidation: Story = {
  render: (args) => (
    <div className="w-[340px]">
      <ChipInput {...args} validate={(chip) => chip.includes('@')} />
    </div>
  ),
};
