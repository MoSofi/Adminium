/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories. The `-ms-2` overlap mirrors
 * automatically under `dir="rtl"`.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from '../avatar/index.js';
import { AvatarStack } from './AvatarStack.js';

const meta: Meta<typeof AvatarStack> = {
  title: 'Tier1/AvatarStack',
  component: AvatarStack,
  argTypes: {
    max: { control: 'number' },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] },
  },
};
export default meta;

type Story = StoryObj<typeof AvatarStack>;

const NAMES = ['Ava Reyes', 'Omar Farouk', 'Lina Chen', 'Noah Patel', 'Maya Haddad', 'Sam Ortiz'];

export const Playground: Story = {
  args: { max: 4, size: 'md', label: 'Assignees' },
  render: (args) => (
    <AvatarStack {...args}>
      {NAMES.map((name) => (
        <Avatar key={name} name={name} size={args.size ?? 'md'} />
      ))}
    </AvatarStack>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      {/* no overflow */}
      <AvatarStack size="md" label="Assignees">
        {NAMES.slice(0, 3).map((name) => (
          <Avatar key={name} name={name} size="md" />
        ))}
      </AvatarStack>
      {/* +N overflow chip */}
      <AvatarStack max={4} size="md" label="Watchers">
        {NAMES.map((name) => (
          <Avatar key={name} name={name} size="md" />
        ))}
      </AvatarStack>
      {/* small size */}
      <AvatarStack max={3} size="sm" label="Editors">
        {NAMES.map((name) => (
          <Avatar key={name} name={name} size="sm" />
        ))}
      </AvatarStack>
    </div>
  ),
};
