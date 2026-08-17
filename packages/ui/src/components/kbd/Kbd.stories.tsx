// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Kbd } from './Kbd.js';

const meta = {
  title: 'Tier1/Kbd',
  component: Kbd,
  args: { children: '⌘K' },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex items-center gap-2 text-body text-fg-muted">
      <Kbd>⌘K</Kbd>
      <Kbd>⇧</Kbd>
      <Kbd>Esc</Kbd>
      <Kbd>↵</Kbd>
      <span className="inline-flex items-center gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>P</Kbd>
      </span>
    </div>
  ),
};
