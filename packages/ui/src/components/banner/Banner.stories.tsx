import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/Button.js';
import { Banner } from './Banner.js';

const meta = {
  title: 'Tier3/Banner',
  component: Banner,
  parameters: { layout: 'fullscreen' },
  args: { tone: 'warn', dismissLabel: 'Dismiss' },
  argTypes: {
    tone: { control: 'select', options: ['info', 'pos', 'warn', 'danger'] },
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Banner {...args} onDismiss={() => {}}>
      Your trial ends in 3 days — pick a plan to keep your workspace.
    </Banner>
  ),
};

export const Tones: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col">
      <Banner tone="info">Scheduled maintenance Sunday 02:00–03:00 UTC.</Banner>
      <Banner tone="pos">Workspace restored from the 03:00 snapshot.</Banner>
      <Banner
        tone="warn"
        action={
          <Button size="sm" variant="secondary">
            Update billing
          </Button>
        }
        onDismiss={() => {}}
        dismissLabel="Dismiss"
      >
        Your payment method expires this month.
      </Banner>
      <Banner tone="danger">Read-only mode: the workspace is suspended for non-payment.</Banner>
    </div>
  ),
};
