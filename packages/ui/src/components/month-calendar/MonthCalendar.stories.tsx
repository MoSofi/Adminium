// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The booking calendar's month grid (322–334, 634–652). Dark, RTL, density and
 * accent come from the Storybook globals and the VRT matrix.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MonthCalendar } from './MonthCalendar.js';

const LABELS = {
  previous: 'Previous month',
  next: 'Next month',
  month: (month: string) => `Days in ${month}`,
};

function Harness({ locale, unavailable }: { locale?: string; unavailable?: string[] }) {
  const [month, setMonth] = useState('2026-09');
  const [value, setValue] = useState<string | null>('2026-09-17');
  return (
    <div className="w-[320px]">
      <MonthCalendar
        month={month}
        onMonth={setMonth}
        value={value}
        onChange={setValue}
        {...(locale === undefined ? {} : { locale })}
        {...(unavailable === undefined ? {} : { unavailable })}
        labels={LABELS}
      />
    </div>
  );
}

const meta: Meta<typeof MonthCalendar> = {
  title: 'Tier2/MonthCalendar',
  component: MonthCalendar,
};
export default meta;

type Story = StoryObj<typeof MonthCalendar>;

export const Playground: Story = {
  render: () => <Harness unavailable={['2026-09-09', '2026-09-18']} />,
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-wrap gap-8">
      {/* The same month in two locales: the week starts in a different place
          and the grid's leading blanks move with it. */}
      <Harness locale="en-US" unavailable={['2026-09-09']} />
      <Harness locale="de-DE" unavailable={['2026-09-09']} />
    </div>
  ),
};
