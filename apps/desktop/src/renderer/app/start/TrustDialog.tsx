// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Open this folder?": asked before anything of a folder is run on this
 * computer. Cancel is first and holds the focus, so a stray Return opens
 * nothing.
 */
import { useT } from '@adminium/i18n/react';
import { Modal, ModalFooter, ModalHeader } from '@adminium/ui';
import { FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';

export interface TrustQuestion {
  path: string;
  displayPath: string;
  /** Agreed to before, and its code is no longer that code. */
  changed: boolean;
}

export function TrustDialog({ question, busy, onCancel, onOpen }: { question: TrustQuestion | null; busy: boolean; onCancel: () => void; onOpen: () => void }): ReactNode {
  const t = useT();
  return (
    <Modal
      open={question !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      className="max-w-[460px] rounded-[16px]"
    >
      {question === null ? null : (
        <>
          <div className="px-6 pt-6">
            <span aria-hidden="true" className="flex size-[38px] items-center justify-center rounded-[11px] bg-warn-soft text-warn">
              <FolderOpen className="size-[18px]" />
            </span>
          </div>
          <ModalHeader
            hideClose
            closeLabel={t('desktop:trust.cancel', 'Cancel')}
            className="px-6 pb-5 pt-3.5"
            title={<span className="text-[18px] font-extrabold tracking-[-0.02em]">{t('desktop:trust.title', 'Open this folder?')}</span>}
            subtitle={
              <span className="mt-3 flex flex-col gap-3">
                <span dir="ltr" className="rounded-[9px] bg-surface-3 px-3 py-2 font-mono text-[12.5px] text-fg [overflow-wrap:anywhere] [unicode-bidi:isolate]">
                  {question.displayPath}
                </span>
                <span className="text-[13.5px] leading-[1.6] text-fg-muted">
                  {question.changed ? `${t('desktop:trust.changed', 'This folder\u2019s code changed since you last opened it.')} ` : ''}
                  {t(
                    'desktop:trust.body',
                    'Opening it runs its code on this computer, with your access to your files. Open only folders you made or that come from someone you trust.',
                  )}
                </span>
              </span>
            }
          />
          <ModalFooter className="flex justify-end gap-2 px-6 pb-6 pt-0">
            <button
              type="button"
              autoFocus
              onClick={onCancel}
              className="cursor-pointer rounded-[10px] border border-border-strong bg-surface px-[18px] py-2.5 text-[13.5px] font-bold text-fg hover:bg-surface-2"
            >
              {t('desktop:trust.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onOpen}
              className="cursor-pointer rounded-[10px] border-0 bg-accent px-5 py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t('desktop:trust.open', 'Open')}
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
