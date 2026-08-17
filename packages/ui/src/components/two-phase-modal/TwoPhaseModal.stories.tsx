// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/Button.js';
import { ModalBody, ModalClose, ModalFooter, ModalHeader } from '../modal/index.js';
import { TwoPhaseModal, useModalFlow } from './TwoPhaseModal.js';

const meta = {
  title: 'Tier3/TwoPhaseModal',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function InviteFlowDemo() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('kim@acme.io');
  const flow = useModalFlow<{ email: string }>();
  return (
    <div className="p-8">
      <Button onClick={() => setOpen(true)}>Invite member</Button>
      <TwoPhaseModal
        open={open}
        onOpenChange={setOpen}
        size="sm"
        flow={flow}
        successTitle="Invitation sent"
        successBody={(p) => `We emailed ${p.email} a link to join the workspace.`}
        doneLabel="Done"
      >
        <ModalHeader
          icon={<UserPlus />}
          title="Invite member"
          subtitle="They will receive an email with a join link."
          closeLabel="Close"
        />
        <ModalBody>
          <label className="mb-1.5 block text-caption font-bold text-fg-muted" htmlFor="invite-email">
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-[34px] w-full rounded-md border border-border-strong bg-surface px-3 text-body text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
        </ModalBody>
        <ModalFooter>
          <ModalClose asChild>
            <Button variant="ghost">Cancel</Button>
          </ModalClose>
          <Button onClick={() => flow.toSuccess({ email })}>Send invite</Button>
        </ModalFooter>
      </TwoPhaseModal>
    </div>
  );
}

export const InviteFlow: Story = { render: () => <InviteFlowDemo /> };
