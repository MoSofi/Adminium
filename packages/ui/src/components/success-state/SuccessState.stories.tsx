// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/Button.js';
import { Card } from '../card/index.js';
import { SuccessState } from './SuccessState.js';

const meta = {
  title: 'Tier3/SuccessState',
  component: SuccessState,
  args: {
    title: 'Invitation sent',
    body: 'We emailed kim@acme.io a link to join the Acme workspace.',
    doneLabel: 'Done',
    autoFocusDone: false,
  },
} satisfies Meta<typeof SuccessState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card className="w-[420px]">
      <SuccessState {...args} />
    </Card>
  ),
};

export const WithSecondaryAction: Story = {
  tags: ['vrt'],
  render: (args) => (
    <Card className="w-[420px]">
      <SuccessState
        {...args}
        actions={
          <Button variant="ghost" onClick={() => {}}>
            Invite another
          </Button>
        }
      />
    </Card>
  ),
};
