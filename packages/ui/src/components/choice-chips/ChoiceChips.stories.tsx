// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Clock, Globe, Zap } from 'lucide-react';

import { ChoiceChips } from './ChoiceChips.js';

const PLANS = [
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'scale', label: 'Scale' },
  { value: 'enterprise', label: 'Enterprise', disabled: true },
];

const meta = {
  title: 'Tier2/ChoiceChips',
  component: ChoiceChips,
  args: { options: PLANS, defaultValue: 'growth' },
} satisfies Meta<typeof ChoiceChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      <ChoiceChips options={PLANS} defaultValue="growth" />
      <ChoiceChips
        multiple
        defaultValue={['realtime', 'cron']}
        options={[
          { value: 'realtime', label: 'Realtime', icon: <Zap /> },
          { value: 'cron', label: 'Scheduled', icon: <Clock /> },
          { value: 'webhook', label: 'Webhooks', icon: <Globe /> },
        ]}
      />
      <ChoiceChips options={PLANS} defaultValue="starter" disabled />
    </div>
  ),
};
