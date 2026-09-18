// SPDX-License-Identifier: AGPL-3.0-only
/** The booking dialog's time grid (342–346, 653–658). */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SlotGrid, slotsBetween } from './SlotGrid.js';

function Harness() {
  const [value, setValue] = useState<string | null>('10:00');
  const slots = slotsBetween('09:00', '12:00', 30).map((slot) => ({
    value: slot,
    taken: slot === '11:00',
  }));
  return (
    <div className="w-[260px]">
      <SlotGrid
        slots={slots}
        value={value}
        onChange={setValue}
        label="Time"
        emptyLabel="No times on this day"
      />
    </div>
  );
}

const meta: Meta<typeof SlotGrid> = { title: 'Tier2/SlotGrid', component: SlotGrid };
export default meta;

type Story = StoryObj<typeof SlotGrid>;

export const Playground: Story = { render: () => <Harness /> };

export const Matrix: Story = { tags: ['vrt'], render: () => <Harness /> };
