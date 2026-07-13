import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon, ICON_SIZES } from './Icon.js';

const meta = {
  title: 'Tier1/Icon',
  component: Icon,
  args: {
    name: 'Search',
    size: 16,
    strokeWidth: 2,
    rtlMirror: false,
  },
  argTypes: {
    name: { control: 'text' },
    size: { control: 'select', options: [...ICON_SIZES] },
    strokeWidth: { control: { type: 'number', min: 1, max: 3, step: 0.5 } },
    rtlMirror: { control: 'boolean' },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Static grid: sizes × representative glyphs, token colors, RTL mirroring. */
export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-6 text-fg">
      <section>
        <h3 className="mb-2 text-caption font-bold text-fg-muted">Sizes</h3>
        <div className="flex items-end gap-3">
          {ICON_SIZES.map((size) => (
            <span key={size} className="flex flex-col items-center gap-1">
              <Icon name="Bell" size={size} />
              <span className="text-micro text-fg-subtle">{size}</span>
            </span>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-caption font-bold text-fg-muted">Inherits currentColor</h3>
        <div className="flex items-center gap-3">
          <span className="text-fg-muted">
            <Icon name="Settings" />
          </span>
          <span className="text-accent">
            <Icon name="Sparkles" />
          </span>
          <span className="text-danger">
            <Icon name="TriangleAlert" />
          </span>
          <span className="text-pos">
            <Icon name="CircleCheck" />
          </span>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-caption font-bold text-fg-muted">
          Directional (rtlMirror) — flips when dir=rtl
        </h3>
        <div className="flex items-center gap-3">
          <Icon name="ChevronRight" rtlMirror />
          <Icon name="ArrowRight" rtlMirror />
          <Icon name="Undo2" rtlMirror />
          <Icon name="LogOut" rtlMirror />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-caption font-bold text-fg-muted">Icon-tile size (26)</h3>
        <span className="inline-flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon name="Database" size={26} />
        </span>
      </section>
    </div>
  ),
};
