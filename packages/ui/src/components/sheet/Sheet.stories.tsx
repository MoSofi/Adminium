// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyRound, Route } from 'lucide-react';

import { Sheet, SheetBar, SheetBody, SheetFooter, SheetHeader } from './Sheet.js';

const meta = {
  title: 'Tier3/Sheet',
  component: Sheet,
  args: { open: true },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

function Footer() {
  return (
    <SheetFooter>
      <span className="text-[12px] text-fg-muted">3 permissions on 2 endpoints</span>
      <div className="ms-auto flex gap-[9px]">
        <button
          type="button"
          className="nb-ib rounded-[10px] border border-border bg-surface px-[15px] py-[9px] text-[13px] font-bold text-fg-muted hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          className="flex items-center gap-[7px] rounded-[10px] bg-accent px-4 py-[9px] text-[13px] font-bold text-accent-fg shadow-glow"
        >
          Create key
        </button>
      </div>
    </SheetFooter>
  );
}

/** One sheet: header, fields bar, tools bar, body, footer. */
export const Default: Story = {
  render: (args) => (
    <Sheet {...args}>
      <SheetHeader icon={<KeyRound />} title="Create API key" subtitle="Pick the endpoints and methods this key may call" closeLabel="Close" />
      <SheetBar variant="fields">
        <span className="text-[11px] font-bold uppercase tracking-[.04em] text-fg-subtle">Key name</span>
      </SheetBar>
      <SheetBar>
        <span className="text-[12px] text-fg-muted">Tools</span>
      </SheetBar>
      <SheetBody>
        <div className="p-5 text-[13px]">Body</div>
      </SheetBody>
      <Footer />
    </Sheet>
  ),
};

/** The builder opened over the key sheet: the lower one is inert, Escape closes the top. */
export const Stacked: Story = {
  render: (args) => (
    <>
      <Sheet {...args}>
        <SheetHeader icon={<KeyRound />} title="Create API key" subtitle="Pick the endpoints and methods this key may call" closeLabel="Close" />
        <SheetBody>
          <div className="p-5">
            <button type="button" className="rounded-[10px] border border-dashed border-border-strong px-3 py-2.5 text-[12.5px] font-bold text-fg-muted">
              New endpoint
            </button>
          </div>
        </SheetBody>
        <Footer />
      </Sheet>
      <Sheet open>
        <SheetHeader icon={<Route />} title="New endpoint" subtitle="Define a route, then grant it" closeLabel="Close builder" />
        <SheetBody>
          <div className="p-5 text-[13px]">Builder</div>
        </SheetBody>
      </Sheet>
    </>
  ),
};
