// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Leaving the editor with unsaved changes: the confirm-modal anatomy
 * reading *Discard unsaved changes?* with *Keep editing* / *Discard*.
 * Undrawn in the comp, which autosaves (524) and so never has anything to
 * discard; an addition the explicit-save model forces (Appendix A E4).
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
        title={t('reportBuilder:editor.discard.title', 'Discard unsaved changes?')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p data-testid="report-discard-body" className="text-body-sm text-fg-muted">
          {t('reportBuilder:editor.discard.body', 'Your edits to {name} will be lost.', { name })}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onKeep} data-testid="report-discard-keep">
          {t('reportBuilder:editor.discard.stay', 'Keep editing')}
        </Button>
        <Button variant="destructive" onClick={onDiscard} data-testid="report-discard-confirm">
          {t('reportBuilder:editor.discard.leave', 'Discard')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
