// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/index.js';
import { Input } from '../input/index.js';
import { Label } from '../label/index.js';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './Popover.js';

const meta = {
  title: 'Tier3/Popover',
  component: PopoverContent,
} satisfies Meta<typeof PopoverContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">Rename view</Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="pop-name">View name</Label>
          <Input id="pop-name" defaultValue="Active customers" />
          <div className="flex justify-end gap-2">
            <PopoverClose asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </PopoverClose>
            <PopoverClose asChild>
              <Button size="sm">Save</Button>
            </PopoverClose>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="h-[220px]">
      <Popover defaultOpen modal={false}>
        <PopoverTrigger asChild>
          <Button variant="secondary">Anchored panel</Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom">
          <p className="text-[13px] leading-5 text-fg-muted">
            Anchored panel on surface with menu elevation. Esc or outside click dismisses.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  ),
};
