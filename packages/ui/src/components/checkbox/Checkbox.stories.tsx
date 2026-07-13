import type { Meta, StoryObj } from '@storybook/react-vite';

import { Label } from '../label/index.js';
import { Checkbox } from './Checkbox.js';

const meta = {
  title: 'Tier2/Checkbox',
  component: Checkbox,
  args: { disabled: false },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Checkbox id="cb-playground" {...args} />
      <Label htmlFor="cb-playground">Email me a receipt</Label>
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Checkbox aria-label="Unchecked" />
        <Checkbox aria-label="Checked" defaultChecked />
        <Checkbox aria-label="Indeterminate" checked="indeterminate" />
        <Checkbox aria-label="Disabled" disabled />
        <Checkbox aria-label="Disabled checked" disabled defaultChecked />
        <Checkbox aria-label="Invalid" aria-invalid />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="cb-labelled" defaultChecked />
        <Label htmlFor="cb-labelled">Notify on failed jobs</Label>
      </div>
    </div>
  ),
};
