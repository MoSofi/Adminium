// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Receipt } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/Button.js';
import { Drawer, DrawerBody, DrawerClose, DrawerFooter, DrawerHeader } from './Drawer.js';
import type { DrawerSize } from './Drawer.js';

const meta = {
  title: 'Tier3/Drawer',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ size }: { size: DrawerSize }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-8">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open {size} drawer
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size={size}>
        <DrawerHeader
          icon={<Receipt />}
          title="Invoice inv_8842"
          subtitle="Created 2 days ago · $1,204.00"
          closeLabel="Close drawer"
        />
        <DrawerBody>
          <p className="text-body-sm text-fg-muted">
            Row details, audit trail and related records render here. The sheet slides from the
            inline-end edge and mirrors in RTL.
          </p>
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DrawerClose>
          <Button onClick={() => setOpen(false)}>Save changes</Button>
        </DrawerFooter>
      </Drawer>
    </div>
  );
}

export const Small: Story = { render: () => <Demo size="sm" /> };
export const Medium: Story = { render: () => <Demo size="md" /> };
export const Large: Story = { render: () => <Demo size="lg" /> };
