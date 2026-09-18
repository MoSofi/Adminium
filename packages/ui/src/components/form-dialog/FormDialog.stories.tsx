// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dialog shell every create and edit form lives in. Dark,
 * RTL, density and accent are the Storybook globals and the VRT matrix, not
 * separate stories; the matrix renders with `modal={false}` + `defaultOpen` so
 * a screenshot needs no interaction.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, Plus, UserPlus } from 'lucide-react';

import { Button } from '../button/index.js';
import { Input } from '../input/index.js';
import { FormField } from '../form-field/index.js';
import {
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTrigger,
} from './FormDialog.js';

const meta: Meta<typeof FormDialog> = {
  title: 'Tier3/FormDialog',
  component: FormDialog,
  argTypes: {
    // The comp's own widths, per dialog: 440 quick · 560 multi-entry · 580
    // segmented-files · 640 sectioned and wizard · 660 choice-cards · 680
    // upload-chips.
    width: { control: 'select', options: [440, 560, 580, 640, 660, 680] },
  },
};
export default meta;

type Story = StoryObj<typeof FormDialog>;

export const Playground: Story = {
  args: { width: 640 },
  render: (args) => (
    <FormDialog {...args}>
      <FormDialogTrigger className="rounded-md bg-accent px-3.5 py-2 text-body font-semibold text-accent-fg">
        New patient
      </FormDialogTrigger>
      <FormDialogHeader
        icon={<UserPlus />}
        title="New patient"
        subtitle="Contact and visit details"
        closeLabel="Close"
      />
      <FormDialogBody>
        <div className="grid grid-cols-2 gap-3.5">
          <FormField label="Full name" required>
            <Input placeholder="Ada Lovelace" />
          </FormField>
          <FormField label="Email">
            <Input placeholder="ada@example.com" />
          </FormField>
        </div>
      </FormDialogBody>
      <FormDialogFooter footnote="Required fields marked *">
        <FormDialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </FormDialogClose>
        <Button variant="primary">
          <Check aria-hidden="true" />
          Create patient
        </Button>
      </FormDialogFooter>
    </FormDialog>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="min-h-[520px]">
      <FormDialog defaultOpen modal={false} width={640}>
        <FormDialogHeader
          icon={<Plus />}
          title="New booking"
          subtitle="Visit and contact details"
          closeLabel="Close"
        />
        <FormDialogBody>
          <div className="grid grid-cols-2 gap-3.5">
            <FormField label="Name" required>
              <Input defaultValue="Grace Hopper" />
            </FormField>
            <FormField label="Phone">
              <Input defaultValue="+1 (555) 000-0000" />
            </FormField>
          </div>
        </FormDialogBody>
        <FormDialogFooter footnote="Required fields marked *">
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">
            <Check aria-hidden="true" />
            Create booking
          </Button>
        </FormDialogFooter>
      </FormDialog>
    </div>
  ),
};
