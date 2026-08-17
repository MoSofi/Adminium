// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories. Matrix renders with `modal={false}`
 * + `defaultOpen` so overlays screenshot without interaction (§8).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Database, UserPlus } from 'lucide-react';

import { Modal, ModalBody, ModalClose, ModalFooter, ModalHeader, ModalTrigger } from './Modal.js';

const meta: Meta<typeof Modal> = {
  title: 'Tier3/Modal',
  component: Modal,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
  },
};
export default meta;

type Story = StoryObj<typeof Modal>;

export const Playground: Story = {
  args: { size: 'md' },
  render: (args) => (
    <Modal {...args}>
      <ModalTrigger className="rounded-md bg-accent px-3.5 py-2 text-body font-semibold text-accent-fg">
        Invite member
      </ModalTrigger>
      <ModalHeader
        icon={<UserPlus />}
        tone="accent"
        title="Invite a member"
        subtitle="They will receive an email with a join link."
        closeLabel="Close dialog"
      />
      <ModalBody>
        <p className="text-body text-fg-muted">
          Form fields go here. The body scrolls when content exceeds 85vh.
        </p>
      </ModalBody>
      <ModalFooter>
        <ModalClose className="rounded-md border border-border-strong bg-surface px-3.5 py-2 text-body font-semibold text-fg">
          Cancel
        </ModalClose>
        <button
          type="button"
          className="rounded-md bg-accent px-3.5 py-2 text-body font-semibold text-accent-fg"
        >
          Send invite
        </button>
      </ModalFooter>
    </Modal>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="min-h-[480px]">
      <Modal defaultOpen modal={false} size="md">
        <ModalHeader
          icon={<Database />}
          tone="info"
          title="Connect a data source"
          subtitle="Read-only credentials are recommended."
          closeLabel="Close dialog"
        />
        <ModalBody>
          <p className="text-body text-fg-muted">
            Body content on the surface. Footer sits on surface-2 below.
          </p>
        </ModalBody>
        <ModalFooter>
          <ModalClose className="rounded-md border border-border-strong bg-surface px-3.5 py-2 text-body font-semibold text-fg">
            Cancel
          </ModalClose>
          <button
            type="button"
            className="rounded-md bg-accent px-3.5 py-2 text-body font-semibold text-accent-fg"
          >
            Connect
          </button>
        </ModalFooter>
      </Modal>
    </div>
  ),
};
