/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CreditCard, Database, Info, ShieldAlert, TriangleAlert, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconTile, type Tone } from './IconTile.js';

const meta: Meta<typeof IconTile> = {
  title: 'Tier1/IconTile',
  component: IconTile,
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
    label: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<typeof IconTile>;

export const Playground: Story = {
  args: { tone: 'accent', size: 'md', icon: <Database /> },
};

const tones: Tone[] = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'];
const toneIcons: Record<Tone, ReactNode> = {
  neutral: <Database />,
  accent: <Users />,
  pos: <CreditCard />,
  warn: <TriangleAlert />,
  danger: <ShieldAlert />,
  info: <Info />,
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          {tones.map((tone) => (
            <IconTile key={tone} tone={tone} size={size} icon={toneIcons[tone]} />
          ))}
        </div>
      ))}
    </div>
  ),
};
