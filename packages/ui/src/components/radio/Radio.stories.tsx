// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Radio, RadioGroup } from './Radio.js';

const meta = {
  title: 'Tier2/Radio',
  component: RadioGroup,
  args: { disabled: false },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <RadioGroup defaultValue="weekly" aria-label="Digest frequency" {...args}>
      <Radio value="daily" label="Daily" />
      <Radio value="weekly" label="Weekly" />
      <Radio value="monthly" label="Monthly" />
    </RadioGroup>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-6">
      <RadioGroup defaultValue="second" aria-label="Plain">
        <Radio value="first" label="Unchecked" />
        <Radio value="second" label="Checked" />
        <Radio value="third" label="Disabled" disabled />
      </RadioGroup>
      <RadioGroup defaultValue="db" aria-label="With descriptions" className="w-[300px]">
        <Radio value="db" label="Database backup" description="Nightly snapshot, retained 30 days." />
        <Radio value="none" label="No backups" description="Not recommended for production." />
      </RadioGroup>
      <RadioGroup defaultValue="a" aria-label="Bare dots" className="flex-row gap-3">
        <Radio value="a" aria-label="Option A" />
        <Radio value="b" aria-label="Option B" />
      </RadioGroup>
    </div>
  ),
};
