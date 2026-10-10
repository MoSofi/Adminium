// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Export this project…", from the Designer inside the desktop app: the choice
 * of what the file holds, said in what it means for whoever opens it, then the
 * app makes the ZIP. The project stops for the moment the file is made, so
 * this page is gone when it is done; the page that comes back says how it went
 * ({@link useExportOutcome}).
 */
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Lock, Package } from 'lucide-react';
import type { DesktopExportKind } from '@adminium/desktop/api';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';
import { useAppToasts } from '../../pages/toasts.js';
import { showInFolderLabel } from './DesktopProject.js';

export function ExportDialog({ name, open, onOpenChange }: { name: string; open: boolean; onOpenChange: (open: boolean) => void }): ReactNode {
  const group = useId();
  const [kind, setKind] = useState<DesktopExportKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options: { id: DesktopExportKind; title: string; line: string }[] = [
    { id: 'everything', title: t('designer:export.everything', 'The project’s apps, its data and its key'), line: t('designer:export.everythingLine', 'Whoever opens it can read all of it, saved database connections included. Send it only to someone you would give that to.') },
    { id: 'apps', title: t('designer:export.apps', 'The apps only'), line: t('designer:export.appsLine', 'Without the data, the key and your chats with the Designer. Whoever opens it starts with empty data.') },
  ];
  const onKey = (event: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const next = kind === 'everything' ? 'apps' : 'everything';
    setKind(next);
    document.getElementById(`${group}-${next}`)?.focus();
  };
  const run = (): void => {
    const project = getDesktopApi()?.project;
    if (kind === null || project?.export === undefined) return;
    setBusy(true);
    setProblem(null);
    project
      .export({ kind, title: t('designer:export.saveTitle', 'Export {name}', { name }), from: `${window.location.pathname}${window.location.search}` })
      .then((result) => {
        setBusy(false);
        if (result.status === 'cancelled') return;
        if (result.status === 'busy') setProblem(t('designer:export.busy', 'Something is still running in this project. Export it when that is done.'));
        else if (result.status === 'failed') setProblem(result.detail);
        // 'saved': the project was stopped for it, and the page that came back says so.
        else onOpenChange(false);
      })
      .catch((error: unknown) => {
        setBusy(false);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };
  return (
    <Modal open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))} size="lg" className="max-w-[560px] rounded-[20px] leading-[normal]">
      <ModalHeader closeLabel={t('designer:model.close', 'Close')} icon={<Package />} title={<span id={group}>{t('designer:export.title', 'Export {name}', { name })}</span>} />
      <ModalBody className="flex flex-col gap-3">
        <div role="radiogroup" aria-labelledby={group} onKeyDown={onKey} className="flex flex-col gap-2.5">
          {options.map((option, index) => {
            const on = kind === option.id;
            return (
              <button
                key={option.id}
                id={`${group}-${option.id}`}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on || (kind === null && index === 0) ? 0 : -1}
                disabled={busy}
                onClick={() => setKind(option.id)}
                className={`flex w-full cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-[15px] text-start text-fg disabled:cursor-not-allowed ${on ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_5%,var(--surface))] shadow-[0_0_0_1px_var(--accent)]' : 'border-border bg-surface shadow-sm'}`}
              >
                <span aria-hidden="true" className={`mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full ${on ? 'bg-accent' : 'border-2 border-fg-subtle'}`}>
                  {on ? <span className="size-[7px] rounded-full bg-accent-fg" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[14px] font-extrabold tracking-[-0.01em]">{option.title}</span>
                  <span className="text-pretty text-[12.5px] leading-normal text-fg-muted">{option.line}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="m-0 flex items-start gap-2 text-[12.5px] leading-normal text-fg-muted">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {t('designer:export.noModelKeys', 'Your model keys are never included: they stay on this computer.')}
        </p>
        <p className="m-0 text-[12.5px] leading-normal text-fg-muted">{t('designer:export.stops', 'The project stops for a moment while the file is made, and this window comes back when it is done.')}</p>
        {problem === null ? null : (
          <p role="alert" className="m-0 text-[12.5px] font-semibold leading-normal text-danger">
            {problem}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
          {t('designer:export.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" disabled={kind === null || busy} onClick={run}>
          {busy ? t('designer:export.working', 'Exporting…') : t('designer:export.go', 'Export…')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Said once by the page that comes back after an export: where it was saved, or why it was not. */
export function useExportOutcome(): void {
  const toasts = useAppToasts();
  useEffect(() => {
    const api = getDesktopApi();
    const project = api?.project;
    if (project?.exportResult === undefined) return;
    let live = true;
    void project.exportResult().then(
      (result) => {
        if (!live || result === null) return;
        if (result.status === 'saved') {
          toasts.push({
            variant: 'success',
            title: t('designer:export.saved', 'Saved {file}, {size} MB', { file: result.file, size: result.megabytes }),
            action: { label: showInFolderLabel(api?.platform), onAction: () => void project.showExport?.() },
          });
        } else if (result.status === 'failed') {
          toasts.push({ variant: 'error', title: t('designer:export.failed', 'The export could not be made'), description: result.detail });
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // Once per page: the outcome is handed over once.
  }, []);
}
