// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wizard's rail (365–372, 660–667). Dark, RTL, density and accent come
 * from the Storybook globals and the VRT matrix, not from separate stories.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { StepRail } from './StepRail.js';

const STEPS = [
  { label: 'Profile', hint: 'Name and photo' },
  { label: 'Role', hint: 'Team and access' },
  { label: 'Access', hint: 'What they may open' },
];

const meta: Meta<typeof StepRail> = {
  title: 'Tier2/StepRail',
  component: StepRail,
  args: { steps: STEPS, current: 1, label: 'Steps' },
};
export default meta;

type Story = StoryObj<typeof StepRail>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((current) => (
        <StepRail key={current} steps={STEPS} current={current} label={`Steps, on ${String(current + 1)}`} />
      ))}
    </div>
  ),
};
