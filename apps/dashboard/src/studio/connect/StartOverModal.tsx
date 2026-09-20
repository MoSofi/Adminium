// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Start over?" — the confirm behind the wizard header's escape hatch.
 *
 * Undrawn in the Connect Database comp, which draws a wizard nobody ever has to
 * leave. A real one can be entered carrying state that no longer makes sense:
 * the wizard resumes from sessionStorage, which outlives reloads, server
 * restarts and sign-outs, so an operator can arrive mid-flight on a source they
 * have stopped caring about — or on a connection someone deleted while the tab
 * was open. Every other way out of that was outside the product (a new tab, or
 * DevTools), which is not a way out.
 *
 * The consequence copy splits on whether a connection was already created,
 * because the honest answer differs: clearing the wizard is not a delete, and
 * saying so is what stops this reading as destructive when it is not.
 */
import { TriangleAlert } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';

export interface StartOverModalProps {
  /** True once the wizard created a connection — it survives, and the copy says so. */
  connectionCreated: boolean;
  onKeep: () => void;
  onStartOver: () => void;
}

export function StartOverModal({ connectionCreated, onKeep, onStartOver }: StartOverModalProps) {
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
        title={t('studio:wizard.startOver.title', 'Start this wizard over?')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p data-testid="wizard-start-over-body" className="text-body-sm text-fg-muted">
          {connectionCreated
            ? t(
                'studio:wizard.startOver.bodyCreated',
                'Everything entered here is cleared and the wizard returns to the first step. The connection Adminium already created is not deleted — it stays in Data connections.',
              )
            : t(
                'studio:wizard.startOver.body',
                'Everything entered here is cleared and the wizard returns to the first step.',
              )}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onKeep} data-testid="wizard-start-over-keep">
          {t('studio:wizard.startOver.keep', 'Keep going')}
        </Button>
        <Button variant="destructive" onClick={onStartOver} data-testid="wizard-start-over-confirm">
          {t('studio:wizard.startOver.confirm', 'Start over')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
