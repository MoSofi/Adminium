// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The comp's boolean (258–261): a bordered row whose second line says what OFF
 * means. Dark, RTL, density and accent are the Storybook globals and the VRT
 * matrix rather than separate stories.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ToggleRow } from './ToggleRow.js';

const meta: Meta<typeof ToggleRow> = {
  title: 'Tier2/ToggleRow',
  component: ToggleRow,
  args: {
    label: 'Publish immediately',
    description: 'Off keeps it as a draft nobody outside your team can open.',
  },
};
export default meta;

type Story = StoryObj<typeof ToggleRow>;

export const Playground: Story = {
  render: (args) => {
    const [checked, setChecked] = useState(true);
    return <ToggleRow {...args} checked={checked} onCheckedChange={setChecked} />;
  },
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex max-w-[420px] flex-col gap-2">
      <ToggleRow
        label="Publish immediately"
        description="Off keeps it as a draft nobody outside your team can open."
        defaultChecked
      />
      <ToggleRow label="Send a receipt" description="The customer gets an email with the details." />
      {/* No description: the label is the whole question. */}
      <ToggleRow label="Active" defaultChecked />
      <ToggleRow label="Archived" description="Hidden from every list." disabled />
    </div>
  ),
};
