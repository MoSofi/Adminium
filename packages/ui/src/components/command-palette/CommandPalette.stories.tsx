// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileDown, LayoutDashboard, Receipt, Settings, Sparkles, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/Button.js';
import { Kbd } from '../kbd/Kbd.js';
import { CommandPalette, type CommandGroup } from './CommandPalette.js';
import { useCommandK } from './useCommandK.js';

const meta = {
  title: 'Tier3/CommandPalette',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const GROUPS: CommandGroup[] = [
  {
    id: 'nav',
    label: 'Navigation',
    items: [
      { id: 'dashboard', label: 'Go to Dashboard', icon: <LayoutDashboard />, hint: 'G D' },
      { id: 'invoices', label: 'Go to Invoices', icon: <Receipt />, keywords: ['billing'], hint: 'G I' },
      { id: 'settings', label: 'Open Settings', icon: <Settings />, hint: 'G S' },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      { id: 'new-user', label: 'Create user', icon: <UserPlus /> },
      { id: 'export', label: 'Export CSV', icon: <FileDown /> },
    ],
  },
];

function Demo() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  useCommandK(() => setOpen((o) => !o));
  return (
    <div className="flex flex-col items-start gap-3 p-8">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open command palette <Kbd className="ms-1">⌘K</Kbd>
      </Button>
      {last === null ? null : <div className="text-body-sm text-fg-muted">Last command: {last}</div>}
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        groups={GROUPS}
        onSelect={(item) => setLast(item.label)}
        labels={{
          dialog: 'Command palette',
          placeholder: 'Search commands…',
          navigate: 'navigate',
          open: 'open',
          close: 'close',
          empty: (q) => (
            <>
              No results for <span className="font-semibold text-fg">&ldquo;{q}&rdquo;</span>
            </>
          ),
        }}
        footerExtra={
          <span className="flex items-center gap-1.5 text-accent">
            <Sparkles className="size-3.5" aria-hidden="true" /> Ask AI
          </span>
        }
      />
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };
