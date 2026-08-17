// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Moon, Pencil, Trash2 } from 'lucide-react';

import { IconButton } from './IconButton.js';

const SIZES = ['sm', 'md', 'lg', 'xl'] as const;

const meta = {
  title: 'Tier1/IconButton',
  component: IconButton,
  args: { label: 'Notifications', variant: 'ghost', size: 'md', children: <Bell className="size-4" /> },
  argTypes: {
    variant: { control: 'select', options: ['bordered', 'ghost'] },
    size: { control: 'select', options: SIZES },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      {(['bordered', 'ghost'] as const).map((variant) => (
        <div key={variant} className="flex items-center gap-2">
          {SIZES.map((size) => (
            <IconButton key={size} variant={variant} size={size} label={`${variant} ${size}`}>
              <Moon className="size-4" />
            </IconButton>
          ))}
          <IconButton variant={variant} label="Edit" disabled>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton variant={variant} label="Delete" className="text-danger hover:text-danger">
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      ))}
    </div>
  ),
};
