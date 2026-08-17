// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Snackbar } from './Snackbar.js';

const meta = {
  title: 'Tier3/Snackbar',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col items-start gap-3 p-8">
      <Snackbar floating={false}>Message archived</Snackbar>
      <Snackbar floating={false} action={{ label: 'Undo', onAction: () => {} }}>
        12 records deleted
      </Snackbar>
    </div>
  ),
};

export const Floating: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="min-h-[240px]">
      <Snackbar action={{ label: 'Undo', onAction: () => {} }}>12 records deleted</Snackbar>
    </div>
  ),
};
