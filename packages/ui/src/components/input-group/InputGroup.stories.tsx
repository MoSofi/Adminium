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
      <InputGroup iconLeading={<Mail />} placeholder="you@company.com" />
      <InputGroup prefix="adminium.io/" defaultValue="acme" mono />
      <InputGroup iconLeading={<Globe />} kbd="⌘K" placeholder="Jump to…" />
      <InputGroup
        iconLeading={<Link />}
        defaultValue="https://acme.io/hooks/9f2c"
        mono
        trailing={<IconButton label="Copy" size="sm"><Copy className="size-3.5" /></IconButton>}
      />
      <InputGroup iconLeading={<Mail />} error defaultValue="not-an-email" />
      <InputGroup iconLeading={<Mail />} disabled defaultValue="disabled@acme.io" />
    </div>
  ),
};
