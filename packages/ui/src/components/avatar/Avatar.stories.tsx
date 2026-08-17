// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories. Fixture names are deterministic
 * (frozen avatar-gradient seeds, BRIEF §4 personas).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from './Avatar.js';

const meta: Meta<typeof Avatar> = {
  title: 'Tier1/Avatar',
  component: Avatar,
  argTypes: {
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] },
    shape: { control: 'select', options: ['circle', 'square'] },
    presence: {
      control: 'select',
      options: [undefined, 'pos', 'warn', 'danger', 'info', 'accent', 'neutral'],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Avatar>;

const NAMES = ['Ava Reyes', 'Omar Farouk', 'Lina Chen', 'Noah Patel', 'Maya Haddad'];

export const Playground: Story = {
  args: { name: 'Ava Reyes', size: 'md', shape: 'circle' },
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      {/* 5 deterministic gradients */}
      <div className="flex items-center gap-3">
        {NAMES.map((name) => (
          <Avatar key={name} name={name} size="lg" />
        ))}
      </div>
      {/* sizes 18–92, circle */}
      <div className="flex items-end gap-3">
        {(['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((size) => (
          <Avatar key={size} name="Ava Reyes" size={size} />
        ))}
      </div>
      {/* rounded-square */}
      <div className="flex items-end gap-3">
        {(['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((size) => (
          <Avatar key={size} name="Omar Farouk" size={size} shape="square" />
        ))}
      </div>
      {/* presence dots */}
      <div className="flex items-center gap-3">
        <Avatar name="Ava Reyes" size="lg" presence="pos" />
        <Avatar name="Omar Farouk" size="lg" presence="warn" />
        <Avatar name="Lina Chen" size="lg" presence="danger" />
        <Avatar name="Noah Patel" size="lg" shape="square" presence="neutral" />
      </div>
      {/* broken image falls back to initials */}
      <div className="flex items-center gap-3">
        <Avatar name="Ava Reyes" size="lg" src="/broken-image.png" />
      </div>
    </div>
  ),
};
