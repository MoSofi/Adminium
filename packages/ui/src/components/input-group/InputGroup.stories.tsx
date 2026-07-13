import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Globe, Link, Mail } from 'lucide-react';

import { IconButton } from '../icon-button/index.js';
import { InputGroup } from './InputGroup.js';

const meta = {
  title: 'Tier2/InputGroup',
  component: InputGroup,
  args: { placeholder: 'Search settings…', error: false, disabled: false },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { iconLeading: <Mail /> },
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[320px] flex-col gap-3">
      <InputGroup iconLeading={<Mail />} placeholder="you@company.com" aria-label="Email" />
      <InputGroup prefix="adminium.io/" defaultValue="acme" mono aria-label="Workspace slug" />
      <InputGroup iconLeading={<Globe />} kbd="⌘K" placeholder="Jump to…" aria-label="Jump to" />
      <InputGroup
        iconLeading={<Link />}
        defaultValue="https://acme.io/hooks/9f2c"
        mono
        aria-label="Webhook URL"
        trailing={<IconButton label="Copy" size="sm"><Copy className="size-3.5" /></IconButton>}
      />
      <InputGroup iconLeading={<Mail />} error defaultValue="not-an-email" aria-label="Email" />
      <InputGroup iconLeading={<Mail />} disabled defaultValue="disabled@acme.io" aria-label="Email" />
    </div>
  ),
};
