// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/Button.js';
import { Card } from '../card/index.js';
import { EmptyState } from './EmptyState.js';

const meta = {
  title: 'Tier3/EmptyState',
  component: EmptyState,
  args: {
    preset: 'no-data',
    title: 'No invoices yet',
    body: 'Create your first invoice to get started.',
  },
  argTypes: {
    preset: {
      control: 'select',
      options: ['no-data', 'all-caught-up', 'no-matches', 'nothing-scheduled'],
    },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card className="w-[520px]">
      <EmptyState {...args} actions={<Button>New invoice</Button>} />
    </Card>
  ),
};

export const Presets: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="grid w-[760px] grid-cols-2 gap-4">
      <Card>
        <EmptyState
          compact
          preset="no-data"
          title="No invoices yet"
          body="Create your first invoice to get started."
          actions={<Button size="sm">New invoice</Button>}
        />
      </Card>
      <Card>
        <EmptyState compact preset="all-caught-up" title="All caught up" body="No tickets need your attention." />
      </Card>
      <Card>
        <EmptyState
          compact
          preset="no-matches"
          title="No matches"
          body="Try a different search or clear the filters."
          actions={
            <Button size="sm" variant="secondary">
              Clear filters
            </Button>
          }
        />
      </Card>
      <Card>
        <EmptyState compact preset="nothing-scheduled" title="Nothing scheduled" body="Your week is clear." />
      </Card>
    </div>
  ),
};
