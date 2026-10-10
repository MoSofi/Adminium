// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project whose packages are not on this computer (one copied from another
 * computer, or whose `node_modules` was deleted): the offer to get them, the
 * wait while they come, and why when they did not.
 *
 * It is asked, not done unasked: the fetch is a download of minutes, and the
 * person opened a folder, not a download.
 */
import { useT } from '@adminium/i18n/react';
import { Modal, ModalFooter, ModalHeader } from '@adminium/ui';
import { LoaderCircle, PackageOpen } from 'lucide-react';
import type { ReactNode } from 'react';

import { elapsedWords } from '../new/NewProjectScreen.js';

export interface PackagesQuestion {
  path: string;
  displayPath: string;
  land: 'designer' | 'dashboard';
  /** When the fetch began (the page's clock); `null` while it is still only asked. */
  since: number | null;
  /** The last lines of a fetch that failed. */
  failure: string | null;
}

export function PackagesDialog({ question, now, onCancel, onGet }: { question: PackagesQuestion | null; now: number; onCancel: () => void; onGet: () => void }): ReactNode {
  const t = useT();
  const working = question !== null && question.since !== null;
  return (
    <Modal
      open={question !== null}
      onOpenChange={(open) => {
        // Once it runs it runs to its end: closing the question would leave a fetch nobody is told the end of.
        if (!open && !working) onCancel();
      }}
      className="max-w-[460px] rounded-[16px]"
    >
      {question === null ? null : (
        <>
          <div className="px-6 pt-6">
            <span aria-hidden="true" className="flex size-[38px] items-center justify-center rounded-[11px] bg-accent-soft text-accent">
              <PackageOpen className="size-[18px]" />
            </span>
          </div>
          <ModalHeader
            hideClose
            closeLabel={t('desktop:packages.cancel', 'Not now')}
            className="px-6 pb-5 pt-3.5"
            title={<span className="text-[18px] font-extrabold tracking-[-0.02em]">{t('desktop:packages.title', 'Get this project’s packages?')}</span>}
            subtitle={
              <span className="mt-3 flex flex-col gap-3">
                <span dir="ltr" className="rounded-[9px] bg-surface-3 px-3 py-2 font-mono text-[12.5px] text-fg [overflow-wrap:anywhere] [unicode-bidi:isolate]">
                  {question.displayPath}
                </span>
                <span className="text-[13.5px] leading-[1.6] text-fg-muted">
                  {t(
                    'desktop:packages.body',
                    'What this project is built with is not on this computer yet. Adminium can download it now and then open the project. It takes a few minutes on a slow connection.',
                  )}
                </span>
                {working ? (
                  <span role="status" className="flex items-center gap-2.5 text-[13px] font-bold text-fg">
                    <LoaderCircle aria-hidden="true" className="size-[15px] animate-spin text-accent" />
                    {t('desktop:packages.working', 'Getting the packages')}
                    <span className="font-mono text-[12px] font-medium tabular-nums text-fg-muted">{elapsedWords(now - (question.since ?? now))}</span>
                  </span>
                ) : null}
                {question.failure === null ? null : (
                  <span role="alert" className="flex flex-col gap-1.5 rounded-[10px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-soft px-3 py-2.5">
                    <span className="text-[13px] font-bold text-fg">{t('desktop:packages.failed', 'The packages could not be fetched.')}</span>
                    <span dir="ltr" className="whitespace-pre-wrap font-mono text-[12px] leading-[1.5] text-fg-muted [overflow-wrap:anywhere]">
                      {question.failure}
                    </span>
                  </span>
                )}
              </span>
            }
          />
          <ModalFooter className="flex justify-end gap-2 px-6 pb-6 pt-0">
            <button
              type="button"
              disabled={working}
              onClick={onCancel}
              className="cursor-pointer rounded-[10px] border border-border-strong bg-surface px-[18px] py-2.5 text-[13.5px] font-bold text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t('desktop:packages.cancel', 'Not now')}
            </button>
            <button
              type="button"
              autoFocus
              disabled={working}
              onClick={onGet}
              className="cursor-pointer rounded-[10px] border-0 bg-accent px-5 py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {question.failure === null ? t('desktop:packages.get', 'Get them and open') : t('desktop:packages.again', 'Try again')}
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
