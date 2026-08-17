// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from '../input/index.js';
import { Select } from '../select/index.js';
import { Tag } from '../tag/index.js';
import { Textarea } from '../textarea/index.js';
import { FormField } from './FormField.js';

const meta = {
  title: 'Tier2/FormField',
  component: FormField,
  args: { label: 'Workspace name', required: false, children: <Input placeholder="Acme Inc." /> },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: ({ children, ...args }) => (
    <div className="w-[300px]">
      <FormField {...args} helper="Shown on invoices and emails.">
        {children}
      </FormField>
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[300px] flex-col gap-5">
      <FormField label="Workspace name" helper="Shown on invoices and emails.">
        <Input placeholder="Acme Inc." />
      </FormField>
      <FormField label="Email" required error="Enter a valid email address.">
        <Input defaultValue="not-an-email" />
      </FormField>
      <FormField label="database_url" tag={<Tag mono>varchar</Tag>}>
        <Input mono defaultValue="postgres://db.internal:5432/app" />
      </FormField>
      <FormField label="Role" required>
        <Select defaultValue="admin">
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </Select>
      </FormField>
      <FormField label="Notes" helper="Optional context for the audit log.">
        <Textarea placeholder="Why are you making this change?" />
      </FormField>
    </div>
  ),
};
