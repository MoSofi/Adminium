import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Card } from '../card/index.js';
import { PasswordStrength } from './PasswordStrength.js';

const meta = {
  title: 'Tier3/PasswordStrength',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const LABELS = ['Weak', 'Fair', 'Good', 'Strong'] as const;

function Demo() {
  const [password, setPassword] = useState('');
  return (
    <Card className="flex w-[380px] flex-col gap-2 p-6">
      <label className="text-caption font-bold text-fg-muted" htmlFor="pw">
        New password
      </label>
      <input
        id="pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-[34px] w-full rounded-md border border-border-strong bg-surface px-3 text-body text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      />
      <PasswordStrength value={password} label="Password strength" labels={LABELS} />
    </Card>
  );
}

export const Playground: Story = { render: () => <Demo /> };

export const Scores: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[320px] flex-col gap-3">
      <PasswordStrength value="abc" label="Password strength" labels={LABELS} />
      <PasswordStrength value="Abcdefgh" label="Password strength" labels={LABELS} />
      <PasswordStrength value="Abcdefg1" label="Password strength" labels={LABELS} />
      <PasswordStrength value="Abcdef1!" label="Password strength" labels={LABELS} />
    </div>
  ),
};
