// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two shapes the comp draws (402–407, 494–500): label + detail, and label +
 * a trailing mono scope. Dark, RTL, density and accent come from the Storybook
 * globals and the VRT matrix, not from separate stories.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { CheckRow } from './CheckRow.js';

const meta: Meta<typeof CheckRow> = {
  title: 'Tier2/CheckRow',
  component: CheckRow,
  args: { label: 'Email', detail: 'Send and receive from the shared address' },
};
export default meta;

type Story = StoryObj<typeof CheckRow>;

export const Playground: Story = {
  render: (args) => {
    const [checked, setChecked] = useState(false);
    return <CheckRow {...args} checked={checked} onCheckedChange={setChecked} />;
  },
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex max-w-[420px] flex-col gap-2">
      <CheckRow label="Email" detail="Send and receive from the shared address" checked />
      <CheckRow label="Calendar" detail="See and book the team's time" />
      <CheckRow label="Manage members" scope="members:write" checked />
      <CheckRow label="Read reports" scope="reports:read" />
      <CheckRow label="Archive" detail="Your administrator turned this off" disabled />
    </div>
  ),
};
