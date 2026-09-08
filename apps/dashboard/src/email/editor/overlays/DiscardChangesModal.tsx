// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Leaving the editor with unsaved changes (39-email-templates-and-
 * campaigns.md D1): the confirm-modal anatomy (comp 153-168) reading
 * *Discard unsaved changes?* with *Keep editing* / *Discard*. Undrawn in the
 * comp (Appendix A §E4); the M9 anatomy is the pattern.
 */
import { TriangleAlert } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../../i18n/t.js';

export interface DiscardChangesModalProps {
  name: string;
  onKeep: () => void;
  onDiscard: () => void;
}

export function DiscardChangesModal({ name, onKeep, onDiscard }: DiscardChangesModalProps) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onKeep();
      }}
    >
      <ModalHeader
        icon={<TriangleAlert />}
        tone="warn"
        title={t('email:editor.discard.title', 'Discard unsaved changes?')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p data-testid="email-discard-body" className="text-body-sm text-fg-muted">
          {t('email:editor.discard.body', 'Your edits to {name} will be lost.', { name })}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onKeep} data-testid="email-discard-keep">
          {t('email:editor.discard.keep', 'Keep editing')}
        </Button>
        <Button variant="destructive" onClick={onDiscard} data-testid="email-discard-confirm">
          {t('email:editor.discard.confirm', 'Discard')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
