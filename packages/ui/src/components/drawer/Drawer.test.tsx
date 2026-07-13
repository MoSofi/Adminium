import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../button/Button.js';
import { Drawer, DrawerBody, DrawerClose, DrawerFooter, DrawerHeader, DrawerTrigger } from './Drawer.js';

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen} size="sm">
      <DrawerTrigger asChild>
        <Button variant="secondary">Open row</Button>
      </DrawerTrigger>
      <DrawerHeader title="Invoice inv_8842" subtitle="Created 2 days ago" closeLabel="Close drawer" />
      <DrawerBody>Row details</DrawerBody>
      <DrawerFooter>
        <DrawerClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('opens from the trigger with dialog semantics and wired title', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open row' }));
    const dialog = screen.getByRole('dialog', { name: 'Invoice inv_8842' });
    expect(dialog).toBeDefined();
    expect(screen.getByText('Row details')).toBeDefined();
  });

  it('closes via the header close button and via Esc', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open row' }));
    await user.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open row' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('anchors to the inline-end edge', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open row' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('end-0')).toBe(true);
    expect(dialog.classList.contains('w-[380px]')).toBe(true);
  });
});
