import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/Button.js';
import { ConfirmModal } from './ConfirmModal.js';

const meta = {
  title: 'Tier3/ConfirmModal',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ async }: { async?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-8">
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="Delete project"
        body="This permanently deletes acme-prod and all 12 tables. This action cannot be undone."
        confirmWord="acme-prod"
        promptLabel='Type "acme-prod" to confirm'
        confirmLabel="Delete project"
        cancelLabel="Cancel"
        closeLabel="Close"
        onConfirm={
          async
            ? () =>
                new Promise<void>((resolve) =>
                  setTimeout(() => {
                    resolve();
                    setOpen(false);
                  }, 1500),
                )
            : () => setOpen(false)
        }
      />
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };
export const AsyncBusy: Story = { render: () => <Demo async /> };
