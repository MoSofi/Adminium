import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/Button.js';
import { Card } from '../card/index.js';
import { Stepper, type Step } from './Stepper.js';

const meta = {
  title: 'Tier3/Stepper',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const STEPS: Step[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'schema', label: 'Schema' },
  { id: 'review', label: 'Review' },
  { id: 'deploy', label: 'Deploy' },
];

function WizardDemo() {
  const [active, setActive] = useState(1);
  return (
    <Card className="w-[560px] p-5">
      <Stepper label="Setup progress" steps={STEPS} activeIndex={active} onStepClick={setActive} />
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" disabled={active === 0} onClick={() => setActive((a) => a - 1)}>
          Back
        </Button>
        <Button disabled={active === STEPS.length - 1} onClick={() => setActive((a) => a + 1)}>
          Continue
        </Button>
      </div>
    </Card>
  );
}

export const Horizontal: Story = { render: () => <WizardDemo /> };

export const States: Story = {
  tags: ['vrt'],
  render: () => (
    <Card className="w-[640px] p-5">
      <Stepper
        steps={[
          { id: 'a', label: 'Connected', state: 'done' },
          { id: 'b', label: 'Analyzing schema', state: 'loading' },
          { id: 'c', label: 'Review', state: 'active' },
          { id: 'd', label: 'Failed', state: 'error' },
          { id: 'e', label: 'Deploy', state: 'pending' },
        ]}
        activeIndex={2}
      />
    </Card>
  ),
};

export const VerticalTimeline: Story = {
  tags: ['vrt'],
  render: () => (
    <Card className="w-[360px] p-5">
      <Stepper
        orientation="vertical"
        activeIndex={2}
        steps={[
          { id: 'a', label: 'Database connected', description: 'postgres://prod-eu-1' },
          { id: 'b', label: 'Schema imported', description: '24 tables, 3 skipped' },
          { id: 'c', label: 'Generating app', description: 'Console + dashboards' },
          { id: 'd', label: 'Deploy', description: 'Pick a region' },
        ]}
      />
    </Card>
  ),
};
