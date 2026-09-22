// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { HTTP_METHODS, MethodBadge } from './MethodBadge.js';

const meta = {
  title: 'Tier1/MethodBadge',
  component: MethodBadge,
  args: { method: 'GET', size: 'sm', radius: 5 },
  argTypes: {
    method: { control: 'select', options: HTTP_METHODS },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    radius: { control: 'inline-radio', options: [5, 6] },
  },
} satisfies Meta<typeof MethodBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Six methods × two sizes, on each surface a badge is placed on. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['bg-bg', 'bg-surface', 'bg-surface-2', 'bg-surface-3'] as const).map((surface) => (
        <div key={surface} className={`flex flex-col gap-2 rounded-[10px] p-3 ${surface}`}>
          {(['sm', 'md'] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-1">
              {HTTP_METHODS.map((method) => (
                <MethodBadge key={method} method={method} size={size} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};
