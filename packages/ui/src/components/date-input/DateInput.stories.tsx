import type { Meta, StoryObj } from '@storybook/react-vite';

import { FormField } from '../form-field/index.js';
import { DateInput, DateRangeInput } from './DateInput.js';

const meta = {
  title: 'Tier2/DateInput',
  component: DateInput,
  args: { type: 'date', error: false, disabled: false },
} satisfies Meta<typeof DateInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="w-[240px]">
      <DateInput aria-label="Date" {...args} />
    </div>
  ),
};

export const Range: Story = {
  render: () => (
    <div className="w-[460px]">
      <FormField label="Billing period">
        <DateRangeInput
          startLabel="Start date"
          endLabel="End date"
          defaultValue={{ start: '2026-07-01', end: '2026-07-31' }}
          presetsLabel="Preset ranges"
          presets={[
            { label: 'This month', value: { start: '2026-07-01', end: '2026-07-31' } },
            { label: 'Last month', value: { start: '2026-06-01', end: '2026-06-30' } },
            { label: 'Year to date', value: { start: '2026-01-01', end: '2026-07-13' } },
          ]}
        />
      </FormField>
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[300px] flex-col gap-3">
      <DateInput aria-label="Date" defaultValue="2026-07-13" />
      <DateInput aria-label="Time" type="time" defaultValue="09:30" />
      <DateInput aria-label="Date and time" type="datetime-local" defaultValue="2026-07-13T09:30" />
      <DateInput aria-label="Error" error defaultValue="2026-07-13" />
      <DateInput aria-label="Disabled" disabled defaultValue="2026-07-13" />
      <DateRangeInput
        className="w-[440px]"
        startLabel="Start date"
        endLabel="End date"
        defaultValue={{ start: '2026-07-01', end: '2026-07-31' }}
      />
    </div>
  ),
};
