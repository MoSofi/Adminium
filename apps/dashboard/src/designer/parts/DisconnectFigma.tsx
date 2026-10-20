// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Disconnect Figma?": one question for one action, asked the same way in the Designer's "From
 * Figma…" dialog and on the person's Security page. Each screen passes its own
 * words: the Security page does not load the Designer's.
 */
import type { ReactNode } from 'react';
import { Button, Modal, ModalHeader } from '@adminium/ui';

/** The words of "Disconnect Figma?": the Designer's own, or the Security page's (each screen reads its own words). */
export interface DisconnectWords {
  title: string;
  body: string;
  cancel: string;
  disconnect: string;
  close: string;
}

/** "Disconnect Figma?": the same question in the dialog and on the Security page. */
export function DisconnectFigma({ open, onOpenChange, busy, onConfirm, words }: { open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; onConfirm: () => void; words: DisconnectWords }): ReactNode {
  return (
    <Modal open={open} onOpenChange={onOpenChange} role="alertdialog" size="sm" className="max-w-[420px]">
      <ModalHeader title={words.title} subtitle={words.body} closeLabel={words.close} hideClose className="px-6 pt-6" />
      <div className="flex justify-end gap-2.5 px-6 pb-6 pt-2">
        <Button variant="secondary" autoFocus onClick={() => onOpenChange(false)} className="h-[38px] font-bold">
          {words.cancel}
        </Button>
        <Button variant="destructive" loading={busy} onClick={onConfirm} className="h-[38px] font-bold">
          {words.disconnect}
        </Button>
      </div>
    </Modal>
  );
}
