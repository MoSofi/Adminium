import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Plus } from 'lucide-react';

import { Button } from './Button.js';

const VARIANTS = [
  'primary',
  'secondary',
  'ghost',
  'outline',
  'destructive',
  'destructiveSoft',
  'soft',
  'link',
  'inverse',
] as const;
const SIZES = ['sm', 'md', 'lg'] as const;

const meta = {
  title: 'Tier1/Button',
  component: Button,
  args: { children: 'Button', variant: 'primary', size: 'md', loading: false, disabled: false },
  argTypes: {
    variant: { control: 'select', options: VARIANTS },
    size: { control: 'select', options: SIZES },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      {SIZES.map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-2">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button loading>Saving</Button>
        <Button variant="secondary" loading>
          Loading
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="destructive" disabled>
          Disabled
        </Button>
        <Button iconLeft={<Plus className="size-3.5" />}>Add row</Button>
        <Button variant="secondary" iconRight={<ArrowRight className="size-3.5 rtl:-scale-x-100" />}>
          Continue
        </Button>
      </div>
    </div>
  ),
};

export const AsChildLink: Story = {
  render: () => (
    <Button asChild variant="soft">
      <a href="/docs">Open docs</a>
    </Button>
  ),
};
