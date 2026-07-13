import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Card } from '../card/index.js';
import { OtpInput } from './OtpInput.js';

const meta = {
  title: 'Tier3/OtpInput',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Card className="flex w-[420px] flex-col items-center gap-4 p-8 text-center">
      <div>
        <div className="text-section text-fg">Two-factor authentication</div>
        <div className="mt-1 text-body-sm text-fg-muted" id="otp-hint">
          Enter the 6-digit code from your authenticator app.
        </div>
      </div>
      <OtpInput label="One-time code" describedBy="otp-hint" onComplete={(code) => setStatus(`Submitted ${code}`)} />
      {status === null ? null : <div className="text-body-sm text-pos">{status}</div>}
    </Card>
  );
}

export const Playground: Story = { render: () => <Demo /> };

export const States: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4">
      <OtpInput label="Code" defaultValue="123" />
      <OtpInput label="Invalid code" defaultValue="123456" invalid />
      <OtpInput label="Disabled code" defaultValue="98" disabled />
    </div>
  ),
};
