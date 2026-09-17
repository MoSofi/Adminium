// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The comp's delete confirm (99-114; M14) in the system's modal anatomy:
 * danger tile, *Delete {name}?*, one sentence, Cancel / Delete. It confirms
 * a HARD delete — this comp has no archive — so the sentence says what the
 * comp's says: it cannot be undone.
 *
 * Shared with the editor's header Delete (comp 267): same props, same copy.
 */
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { ReportDocumentKind } from '../api.js';
import { TrashGlyph } from './GalleryCard.js';

export interface DeleteModalProps {
  kind: ReportDocumentKind;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteModal({ kind, name, busy, onCancel, onConfirm }: DeleteModalProps) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <ModalHeader icon={<TrashGlyph />} tone="danger" title={t('reportBuilder:delete.title', 'Delete {name}?', { name })} closeLabel={t('common.close', 'Close')} />
      <ModalBody>
        <p data-testid="report-delete-body" className="text-body-sm text-fg-muted">
          {kind === 'template'
            ? t('reportBuilder:delete.body.template', 'This can’t be undone. The template will be permanently removed.')
            : t('reportBuilder:delete.body.report', 'This can’t be undone. The report will be permanently removed.')}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" onClick={onConfirm} loading={busy} data-testid="report-delete-confirm">
          {t('reportBuilder:delete.confirm', 'Delete')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
