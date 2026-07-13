/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories. The tooltip surface is the inverted
 * `--fg`/`--bg` pair, so it flips correctly in dark mode by itself.
 * Matrix renders open by default so VRT can screenshot without interaction.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tooltip } from './Tooltip.js';

const meta: Meta<typeof Tooltip> = {
  title: 'Tier3/Tooltip',
  component: Tooltip,
  argTypes: {
    side: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
    align: { control: 'select', options: ['start', 'center', 'end'] },
    delayDuration: { control: 'number' },
  },
};
export default meta;

type Story = StoryObj<typeof Tooltip>;

export const Playground: Story = {
  args: { content: 'Copy connection string', side: 'top', delayDuration: 300 },
  render: (args) => (
    <div className="grid h-40 place-items-center">
      <Tooltip {...args}>
        <button
          type="button"
          className="rounded-md border border-border-strong bg-surface px-3.5 py-2 text-body font-semibold text-fg"
        >
          Hover or focus me
        </button>
      </Tooltip>
    </div>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex h-48 items-center justify-center gap-24 pt-16">
      {(['top', 'bottom'] as const).map((side) => (
        <Tooltip key={side} content={`Tooltip on ${side}`} side={side} defaultOpen>
          <button
            type="button"
            className="rounded-md border border-border-strong bg-surface px-3.5 py-2 text-body font-semibold text-fg"
          >
            {side}
          </button>
        </Tooltip>
      ))}
    </div>
  ),
};
