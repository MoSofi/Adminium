// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Apply to the other languages?" (comp 244-259, 1325-1338; Appendix A §E4;
 * D1): after a structural edit on a document with live sibling variations,
 * the operator chooses *Only {native}* or *Apply to all N*. Under D1 the op
 * is QUEUED and rides the next save — nothing reaches the siblings until the
 * operator saves this document.
 */
import { Languages } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../../i18n/t.js';

export interface MirrorModalProps {
  /** What was done, e.g. "Heading added". */
  label: string;
  topicLabel: string;
  /** The current variation's native name. */
  native: string;
  siblingCount: number;
  onOnlyThis: () => void;
  onApplyAll: () => void;
}

export function MirrorModal({ label, topicLabel, native, siblingCount, onOnlyThis, onApplyAll }: MirrorModalProps) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onOnlyThis();
      }}
    >
      <ModalHeader
        icon={<Languages />}
        title={t('email:mirror.title', 'Apply to the other languages?')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p data-testid="email-mirror-body" className="text-body-sm text-fg-muted">
          {t(
            'email:mirror.body',
            '{label} can be mirrored to the {count, plural, one {# other language variation} other {# other language variations}} of {topic}. Copy comes across untranslated, when you save.',
            { label, count: siblingCount, topic: topicLabel },
          )}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onOnlyThis} data-testid="email-mirror-only">
          {t('email:mirror.onlyThis', 'Only {native}', { native })}
        </Button>
        <Button onClick={onApplyAll} data-testid="email-mirror-all">
          {t('email:mirror.applyAll', 'Apply to all {count}', { count: siblingCount })}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
