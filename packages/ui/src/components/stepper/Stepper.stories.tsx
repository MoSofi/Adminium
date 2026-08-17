// SPDX-License-Identifier: AGPL-3.0-only
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
    <Card className="w-[760px] p-5">
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

/**
 * The real connect wizard: 7 steps in the 760px column it actually renders in
 * (`apps/dashboard/src/studio/connect/ConnectWizard.tsx`). The 4-step story
 * above never showed the failure — at seven, every label used to truncate to
 * "Int… So… An…". Past COMPACT_STEP_COUNT only the active step is labelled;
 * the rest keep their names for screen readers and on hover.
 */
const CONNECT_STEPS: Step[] = [
  { id: 'intent', label: 'Intent' },
  { id: 'source', label: 'Source' },
  { id: 'test', label: 'Analyze' },
  { id: 'tables', label: 'Tables' },
  { id: 'meta', label: 'Meta storage' },
  { id: 'enrich', label: 'Enrich' },
  { id: 'generate', label: 'Generate' },
];

function ConnectWizardStepper() {
  const [active, setActive] = useState(0);
  return (
    <div className="w-[760px] bg-bg p-6">
      <Stepper label="Setup progress" steps={CONNECT_STEPS} activeIndex={active} onStepClick={setActive} />
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        {active === 0 ? null : (
          <Button variant="ghost" onClick={() => setActive((a) => a - 1)}>
            Back
          </Button>
        )}
        <Button
          className="ms-auto"
          disabled={active === CONNECT_STEPS.length - 1}
          onClick={() => setActive((a) => a + 1)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

export const SevenStepWizard: Story = { render: () => <ConnectWizardStepper /> };
