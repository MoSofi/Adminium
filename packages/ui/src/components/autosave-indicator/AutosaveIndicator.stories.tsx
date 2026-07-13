import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { AutosaveIndicator, type AutosaveStatus } from './AutosaveIndicator.js';

const meta = {
  title: 'Tier3/AutosaveIndicator',
  component: AutosaveIndicator,
  args: {
    status: 'saving',
    savingLabel: 'Saving…',
    savedLabel: 'All changes saved',
    errorLabel: "Couldn't save",
  },
  argTypes: {
    status: { control: 'select', options: ['idle', 'saving', 'saved', 'error'] },
  },
} satisfies Meta<typeof AutosaveIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

function CycleDemo() {
  const [status, setStatus] = useState<AutosaveStatus>('saving');
  useEffect(() => {
    const timer = setInterval(
      () => setStatus((s) => (s === 'saving' ? 'saved' : s === 'saved' ? 'idle' : 'saving')),
      1800,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <AutosaveIndicator
      status={status}
      savingLabel="Saving…"
      savedLabel="All changes saved"
      errorLabel="Couldn't save"
    />
  );
}

export const Cycling: Story = { render: () => <CycleDemo /> };
