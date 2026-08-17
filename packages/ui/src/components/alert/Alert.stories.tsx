// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/Button.js';
import { Alert } from './Alert.js';

const meta = {
  title: 'Tier3/Alert',
  component: Alert,
  args: {
    tone: 'info',
    title: 'Scheduled maintenance',
    body: 'The API will be read-only on Sunday from 02:00 to 03:00 UTC.',
  },
  argTypes: {
    tone: { control: 'select', options: ['info', 'pos', 'warn', 'danger'] },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="w-[480px]">
      <Alert {...args} />
    </div>
  ),
};

export const Tones: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[480px] flex-col gap-3">
      <Alert tone="info" title="Scheduled maintenance" body="The API will be read-only Sunday 02:00–03:00 UTC." />
      <Alert tone="pos" title="Backup completed" body="Nightly snapshot finished in 42s." />
      <Alert
        tone="warn"
        title="Storage almost full"
        body="You have used 92% of available disk space."
        action={
          <Button size="sm" variant="secondary">
            Free up space
          </Button>
        }
      />
      <Alert tone="danger" title="Sync failed" body="stripe_invoices: connection timed out after 30s." />
    </div>
  ),
};
