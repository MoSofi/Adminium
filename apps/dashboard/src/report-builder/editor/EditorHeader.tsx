// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's header row (comp 249-271; 43-report-builder.md Appendix A
 * E1–E11): kind pill · inline name · save chip · undo/redo · Duplicate ·
 * Delete · primary. Sticky under the shell's topbar, blurred like the comp's.
 *
 * Back is NOT here: the shell's topbar owns the back affordance (published
 * through `PageActions backTo`), and the discard guard is a router blocker,
 * so the topbar's Back, the sidebar and the browser all run it — one Back on
 * screen, not two (34 DEP-13/14, kept). The comp's theme toggle (265) is
 * shell chrome, dropped at S2; so is its *Ask Milo* button, which belongs to
 * plan 44's modal and is not this surface's to mount.
 *
 * THE PRIMARY (comp 268, 686; D5/O2): a template's is *Save template* with
 * `save`; a report's is *Publish* with `send` — it saves AND sets
 * `status: 'sent'` (*Published*), which is the smallest thing the comp's own
 * status vocabulary supports. Nothing is rendered, printed or sent (43 §5
 * item 1).
 */
import type { FocusEvent, Ref } from 'react';
import { Button, IconButton, Tag, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { ReportDocumentKind } from '../api.js';
import { reportIcon } from '../icons.js';
import { SaveChip } from './SaveChip.js';
import type { SaveStatus } from './useEditorDraft.js';

export interface EditorHeaderProps {
  kind: ReportDocumentKind;
  name: string;
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onNameFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onNameChange: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPrimary: () => void;
  /** The editor measures the header for its sticky offsets. */
  ref?: Ref<HTMLElement> | undefined;
}

/** The comp's primary label (686) under D5. */
export function primaryLabel(kind: ReportDocumentKind): string {
  return kind === 'template' ? t('reportBuilder:editor.primary.template', 'Save template') : t('reportBuilder:editor.primary.report', 'Publish');
}

export function EditorHeader({
  kind,
  name,
  status,
  error,
  canUndo,
  canRedo,
  onNameFocus,
  onNameChange,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onPrimary,
  ref,
}: EditorHeaderProps) {
  const isTemplate = kind === 'template';
  const KindGlyph = reportIcon(isTemplate ? 'layout-template' : 'file-bar-chart-2');
  const UndoGlyph = reportIcon('undo-2');
  const RedoGlyph = reportIcon('redo-2');
  const CopyGlyph = reportIcon('copy');
  const TrashGlyph = reportIcon('trash-2');
  const PrimaryGlyph = reportIcon(isTemplate ? 'save' : 'send');
  return (
    <header
      ref={ref}
      data-testid="report-editor-header"
      className="sticky top-[var(--adm-topbar-h,0px)] z-20 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-[22px] py-3 backdrop-blur-[8px]"
    >
      <div className="flex min-w-[120px] flex-[0_1_auto] items-center gap-[9px] overflow-hidden">
        <Tag tone="neutral" className="shrink-0 gap-[5px] rounded-[20px] px-[9px] py-[3px] text-[10.5px]">
          <KindGlyph className="size-3" aria-hidden="true" />
          {isTemplate ? t('reportBuilder:editor.kind.template', 'Template') : t('reportBuilder:editor.kind.report', 'Report')}
        </Tag>
        <input
          data-testid="report-editor-name"
          aria-label={t('reportBuilder:editor.nameLabel', 'Name')}
          value={name}
          maxLength={120}
          onFocus={onNameFocus}
          onChange={(event) => onNameChange(event.target.value)}
          className={cn(
            'min-w-10 max-w-[300px] rounded-md border-0 bg-transparent px-1.5 py-1 text-[16px] font-extrabold tracking-[-.02em] text-fg outline-none',
            'placeholder:text-fg-subtle focus:bg-accent-soft focus:shadow-[0_0_0_3px_var(--accent-soft)]',
          )}
        />
      </div>
      <SaveChip status={status} error={error} />
      {/* The header wraps (`flex-wrap` above); this group has to wrap with it, or
          at 390 px it forces the whole SHELL to scroll sideways (34 DEP-32). The
          group is only ever one row at the comp's desktop width (249-271). */}
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
        <div className="flex gap-0.5 rounded-[9px] border border-border bg-surface-2 p-[3px]">
          <IconButton variant="ghost" size="md" label={t('reportBuilder:editor.undo', 'Undo')} onClick={onUndo} disabled={!canUndo} data-testid="report-undo">
            <UndoGlyph className="size-[15px]" />
          </IconButton>
          <IconButton variant="ghost" size="md" label={t('reportBuilder:editor.redo', 'Redo')} onClick={onRedo} disabled={!canRedo} data-testid="report-redo">
            <RedoGlyph className="size-[15px]" />
          </IconButton>
        </div>
        <IconButton variant="bordered" size="xl" label={t('reportBuilder:editor.duplicate', 'Duplicate')} tooltip onClick={onDuplicate} data-testid="report-duplicate">
          <CopyGlyph className="size-4" />
        </IconButton>
        <IconButton variant="bordered" size="xl" label={t('reportBuilder:editor.delete', 'Delete')} tooltip onClick={onDelete} data-testid="report-delete">
          <TrashGlyph className="size-4" />
        </IconButton>
        <Button iconLeft={<PrimaryGlyph />} onClick={onPrimary} disabled={status === 'saving'} data-testid="report-save">
          {primaryLabel(kind)}
        </Button>
      </div>
    </header>
  );
}
