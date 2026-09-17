// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's header row (comp 461-492, Appendix A §E1): kind pill · inline
 * name · language menu · save chip · undo/redo · Duplicate · Delete · Test ·
 * primary. Sticky under the shell's topbar, blurred like the comp's.
 *
 * Back is NOT here: the shell's topbar owns the back affordance (published
 * through `PageActions backTo`), and the D1 guard is a router blocker, so the
 * topbar's Back, the sidebar and the browser all run it — one Back on screen,
 * not two (departure). The shell scrolls the PAGE, with its own sticky
 * topbar, so this header sticks just under it (`--adm-topbar-h`, measured by
 * the editor) rather than at the comp's `top: 0`.
 *
 * A campaign gets a secondary *Save* before the primary *Send campaign* (D11);
 * a template's primary IS the save. While a run is scheduled or running the
 * campaign wears a chip — *Scheduled · date* / *Sending · N %* — with an
 * explicit cancel beside it (D11: cancel is explicit), and *Send campaign*
 * waits: the server refuses a second active run anyway.
 */
import { CalendarClock, Copy, LayoutTemplate, Loader2, Redo2, Save, Send, Trash2, Undo2 } from 'lucide-react';
import type { FocusEvent, Ref } from 'react';
import { Button, IconButton, Tag, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { formatStamp } from '../../team/teamApi.js';
import type { EmailDocumentKind, EmailLanguageView, EmailRunView } from '../api.js';
import type { RunProgress } from '../useRunProgress.js';
import { LanguageMenu } from './LanguageMenu.js';
import { SaveChip } from './SaveChip.js';
import type { SaveStatus } from './useEditorDraft.js';

export interface EditorHeaderProps {
  kind: EmailDocumentKind;
  name: string;
  locale: string;
  languages: readonly EmailLanguageView[];
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  addingLocale: string | null;
  onNameFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onNameChange: (name: string) => void;
  onOpenLanguage: (id: string) => void;
  onAddLanguage: (locale: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSave: () => void;
  onSend: () => void;
  testAvailable: boolean;
  /** A campaign that is not archived and has no scheduled/running run. */
  sendAvailable: boolean;
  /** The campaign's latest run — the chip shows while it is scheduled or running. */
  run?: EmailRunView | undefined;
  progress: RunProgress | null;
  /** BCP 47, for the schedule stamp. */
  localeTag: string;
  onCancelRun: () => void;
  cancelling: boolean;
  /** The editor measures the header for its sticky offsets. */
  ref?: Ref<HTMLElement> | undefined;
}

export function EditorHeader({
  kind,
  name,
  locale,
  languages,
  status,
  error,
  canUndo,
  canRedo,
  addingLocale,
  onNameFocus,
  onNameChange,
  onOpenLanguage,
  onAddLanguage,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onTest,
  onSave,
  onSend,
  testAvailable,
  sendAvailable,
  run,
  progress,
  localeTag,
  onCancelRun,
  cancelling,
  ref,
}: EditorHeaderProps) {
  const isTemplate = kind === 'template';
  const activeRun = run !== undefined && (run.status === 'scheduled' || run.status === 'running') ? run : null;
  return (
    <header
      ref={ref}
      data-testid="email-editor-header"
      className="sticky top-[var(--adm-topbar-h,0px)] z-20 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-[22px] py-3 backdrop-blur-[8px]"
    >
      <div className="flex min-w-[120px] flex-[0_1_auto] items-center gap-[9px] overflow-hidden">
        <Tag tone="neutral" className="shrink-0 gap-[5px] rounded-[20px] px-[9px] py-[3px] text-[10.5px]">
          {isTemplate ? <LayoutTemplate className="size-3" aria-hidden="true" /> : <Send className="size-3" aria-hidden="true" />}
          {isTemplate ? t('email:editor.kind.template', 'Template') : t('email:editor.kind.campaign', 'Campaign')}
        </Tag>
        <input
          data-testid="email-editor-name"
          aria-label={t('email:editor.nameLabel', 'Name')}
          value={name}
          maxLength={120}
          onFocus={onNameFocus}
          onChange={(event) => onNameChange(event.target.value)}
          className={cn(
            'min-w-10 max-w-60 rounded-[5px] border-0 bg-transparent px-1.5 py-1 text-[16px] font-extrabold tracking-[-.02em] text-fg outline-none',
            'placeholder:text-fg-subtle focus-visible:ring-[3px] focus-visible:ring-accent-soft',
          )}
        />
      </div>
      <LanguageMenu currentLocale={locale} languages={languages} adding={addingLocale} onOpen={onOpenLanguage} onAdd={onAddLanguage} />
      <SaveChip status={status} error={error} />
      {activeRun === null ? null : (
        <div className="flex items-center gap-1.5" data-testid="email-run-chip" data-status={activeRun.status}>
          <Tag tone={activeRun.status === 'scheduled' ? 'warn' : 'accent'} className="gap-1 rounded-[20px] px-[9px] py-[3px] text-[10.5px]">
            {activeRun.status === 'scheduled' ? <CalendarClock className="size-3" aria-hidden="true" /> : <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
            {activeRun.status === 'scheduled'
              ? t('email:campaign.chipScheduled', 'Scheduled · {when}', { when: formatStamp(activeRun.scheduledAt, localeTag) ?? '' })
              : t('email:campaign.chipSending', 'Sending · {pct}%', { pct: progress?.pct ?? 0 })}
          </Tag>
          <Button variant="outline" size="sm" onClick={onCancelRun} loading={cancelling} data-testid="email-cancel-run">
            {activeRun.status === 'scheduled' ? t('email:campaign.cancelSchedule', 'Cancel schedule') : t('email:campaign.cancelSending', 'Cancel sending')}
          </Button>
        </div>
      )}
      <div className="ms-auto flex items-center gap-2">
        <div className="flex gap-0.5 rounded-[9px] border border-border bg-surface-2 p-[3px]">
          <IconButton variant="ghost" size="sm" label={t('email:editor.undo', 'Undo')} onClick={onUndo} disabled={!canUndo} data-testid="email-undo">
            <Undo2 className="size-[15px]" />
          </IconButton>
          <IconButton variant="ghost" size="sm" label={t('email:editor.redo', 'Redo')} onClick={onRedo} disabled={!canRedo} data-testid="email-redo">
            <Redo2 className="size-[15px]" />
          </IconButton>
        </div>
        <IconButton variant="bordered" size="xl" label={t('email:card.duplicate', 'Duplicate')} tooltip onClick={onDuplicate}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton variant="bordered" size="xl" label={t('email:card.delete', 'Delete')} tooltip onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconButton>
        <Button variant="secondary" iconLeft={<Send />} onClick={onTest} disabled={!testAvailable} data-testid="email-test">
          {t('email:editor.test', 'Test')}
        </Button>
        {isTemplate ? (
          <Button iconLeft={<Save />} onClick={onSave} disabled={status === 'saving'} data-testid="email-save">
            {t('email:editor.saveTemplate', 'Save template')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" iconLeft={<Save />} onClick={onSave} disabled={status === 'saving'} data-testid="email-save">
              {t('email:editor.save', 'Save')}
            </Button>
            <Button iconLeft={<Send />} onClick={onSend} disabled={!sendAvailable} data-testid="email-send">
              {t('email:editor.sendCampaign', 'Send campaign')}
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
