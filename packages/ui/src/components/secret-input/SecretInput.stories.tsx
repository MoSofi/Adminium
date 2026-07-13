import type { Meta, StoryObj } from '@storybook/react-vite';

import { SecretInput } from './SecretInput.js';

const meta = {
  title: 'Tier2/SecretInput',
  component: SecretInput,
  args: {
    defaultValue: 'sk_live_4eC39HqLyjWDarjtT1zdp7dc',
    revealLabel: 'Reveal value',
    hideLabel: 'Hide value',
    copyLabel: 'Copy value',
    copiedLabel: 'Copied',
    // real usage wires the name via FormField/htmlFor; standalone needs one
    'aria-label': 'API key',
  },
} satisfies Meta<typeof SecretInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: (args) => (
    <div className="flex w-[340px] flex-col gap-3">
      <SecretInput {...args} />
      <SecretInput {...args} readOnly defaultValue="whsec_9f2ce01ab34d" />
      <SecretInput {...args} error />
      <SecretInput {...args} disabled />
    </div>
  ),
};
