import type { Meta, StoryObj } from '@storybook/react-vite';

import { Breadcrumbs } from './Breadcrumbs.js';

const meta = {
  title: 'Tier3/Breadcrumbs',
  component: Breadcrumbs,
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  tags: ['vrt'],
  args: {
    label: 'Breadcrumb',
    items: [
      { label: 'Workspace', href: '#' },
      { label: 'Invoices', href: '#' },
      { label: 'inv_8842', mono: true },
    ],
  },
};

export const DeepPath: Story = {
  args: {
    label: 'Breadcrumb',
    items: [
      { label: 'Workspace', href: '#' },
      { label: 'Data', href: '#' },
      { label: 'stripe_invoices', mono: true, href: '#' },
      { label: 'Row', href: '#' },
      { label: 'inv_8842_very_long_identifier_that_truncates', mono: true },
    ],
  },
};
