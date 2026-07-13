import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from '../avatar/index.js';
import { FormField } from '../form-field/index.js';
import { Combobox } from './Combobox.js';

const people = [
  { value: 'usr_1', label: 'Amira Hassan', description: 'amira@acme.io', leading: <Avatar name="Amira Hassan" size="xs" /> },
  { value: 'usr_2', label: 'Jonas Weber', description: 'jonas@acme.io', leading: <Avatar name="Jonas Weber" size="xs" /> },
  { value: 'usr_3', label: 'Mei Lin', description: 'mei@acme.io', leading: <Avatar name="Mei Lin" size="xs" /> },
  { value: 'usr_4', label: 'Sam Ortiz', description: 'sam@acme.io', leading: <Avatar name="Sam Ortiz" size="xs" />, disabled: true },
];

const plain = [
  { value: 'utc', label: 'UTC' },
  { value: 'cairo', label: 'Africa/Cairo' },
  { value: 'berlin', label: 'Europe/Berlin' },
  { value: 'tokyo', label: 'Asia/Tokyo' },
];

const meta = {
  title: 'Tier2/Combobox',
  component: Combobox,
  args: {
    options: plain,
    emptyText: 'No matches',
    placeholder: 'Search timezones…',
    disabled: false,
    error: false,
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="w-[300px]">
      <Combobox aria-label="Timezone" {...args} />
    </div>
  ),
};

export const AvatarRows: Story = {
  render: () => (
    <div className="w-[320px]">
      <FormField label="Assignee" helper="Only workspace members appear here.">
        <Combobox options={people} emptyText="No matches" placeholder="Search members…" />
      </FormField>
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[300px] flex-col gap-4">
      <Combobox aria-label="Default" options={plain} emptyText="No matches" placeholder="Search…" />
      <Combobox aria-label="Selected" options={plain} defaultValue="berlin" emptyText="No matches" />
      <Combobox aria-label="Error" options={plain} error emptyText="No matches" placeholder="Required" />
      <Combobox aria-label="Disabled" options={plain} defaultValue="utc" disabled emptyText="No matches" />
      <Combobox aria-label="Mono" options={plain} mono defaultValue="cairo" emptyText="No matches" />
    </div>
  ),
};
