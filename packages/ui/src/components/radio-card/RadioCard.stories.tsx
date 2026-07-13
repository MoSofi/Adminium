import type { Meta, StoryObj } from '@storybook/react-vite';
import { Cloud, HardDrive, Server } from 'lucide-react';

import { MonoText } from '../mono-text/index.js';
import { RadioGroup } from '../radio/index.js';
import { RadioCard } from './RadioCard.js';

const meta = {
  title: 'Tier2/RadioCard',
  component: RadioCard,
} satisfies Meta<typeof RadioCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { value: 'unused', title: 'unused' },
  render: () => (
    <RadioGroup defaultValue="postgres" aria-label="Database" className="w-[340px]">
      <RadioCard
        value="sqlite"
        icon={<HardDrive />}
        title="SQLite"
        description="Zero-config single file. Great for getting started."
      />
      <RadioCard
        value="postgres"
        icon={<Server />}
        title="PostgreSQL"
        description="Production-grade. Connection string required."
      />
      <RadioCard value="mysql" icon={<Cloud />} title="MySQL" description="Also fine." disabled />
    </RadioGroup>
  ),
};

export const Matrix: Story = {
  args: { value: 'unused', title: 'unused' },
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-6">
      <RadioGroup defaultValue="pro" aria-label="Plan" className="w-[340px]">
        <RadioCard value="free" title="Free" description="1 workspace, community support." trailing={<MonoText>$0</MonoText>} />
        <RadioCard value="pro" title="Pro" description="Unlimited workspaces, priority support." trailing={<MonoText>$12/mo</MonoText>} />
        <RadioCard value="team" title="Team" description="SSO, audit log, RBAC." trailing={<MonoText>$39/mo</MonoText>} disabled />
      </RadioGroup>
      <RadioGroup defaultValue="b" aria-label="Bare" orientation="horizontal" className="w-[480px] flex-row">
        <RadioCard value="a" title="No indicator" hideIndicator />
        <RadioCard value="b" title="Selected" hideIndicator />
      </RadioGroup>
    </div>
  ),
};
