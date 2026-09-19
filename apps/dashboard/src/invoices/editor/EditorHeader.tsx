// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's header row (comp 328-362): kind pill · inline name
 * · save chip · undo/redo · Ask … · language menu · Images · Duplicate · Delete ·
 * primary. Sticky under the shell's topbar, blurred like the comp's.
 *
 * Back is NOT here: the shell's topbar owns the back affordance (published
 * through `PageActions backTo`), and the discard guard is a router blocker,
 * so the topbar's Back, the sidebar and the browser all run it — one Back on
 * screen, not two (39's departure, kept). The comp's theme toggle (343) is
 * shell chrome, dropped at S2. The shell scrolls the PAGE with its own sticky
 * topbar, so this header sticks just under it (`--adm-topbar-h`, measured by
 * the editor) rather than at the comp's `top: 0`.
 *
 * The primary (comp 360, 1599; O24): a template's is *Save template*; an
 * invoice's is *Send invoice* only when a document provider is installed —
 * with none (always, today: `useProvider`) it reads *Save invoice* and only
 * saves. No Test, no device switch, no campaign chrome (E10).
 */
import { Copy, FileText, Image, LayoutTemplate, Redo2, Save, Send, Trash2, Undo2 } from 'lucide-react';
import type { FocusEvent, ReactNode, Ref } from 'react';
import { Button, IconButton, Tag, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InvoiceDocumentKind, InvoiceLanguageView } from '../api.js';
import type { InvoiceLang } from '../model/languages.js';
import { LanguageMenu } from './LanguageMenu.js';
import { SaveChip } from './SaveChip.js';
import type { SaveStatus } from './useEditorDraft.js';

export interface EditorHeaderProps {
  kind: InvoiceDocumentKind;
  name: string;
  lang: InvoiceLang;
  languages: readonly InvoiceLanguageView[];
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  addingLang: InvoiceLang | null;
  /** A document provider is installed: an invoice's primary sends (O24). */
  providerInstalled: boolean;
  onNameFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onNameChange: (name: string) => void;
  onOpenLanguage: (id: string) => void;
  onCreateLanguage: (lang: InvoiceLang) => void;
  onUndo: () => void;
  onRedo: () => void;
  onImages: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPrimary: () => void;
  /**
   * The comp's *Ask …* button, in its slot after the undo/redo tray. Passed
   * as a node rather than built here: this header is presentational, and the
   * button needs the page's assistant host, which only the editor holds.
   */
  askAssistant?: ReactNode;
  /** The editor measures the header for its sticky offsets. */
  ref?: Ref<HTMLElement> | undefined;
}

/** The comp's primary label (1599) under O24. */
export function primaryLabel(kind: InvoiceDocumentKind, providerInstalled: boolean): string {
  if (kind === 'template') return t('invoices:editor.saveTemplate', 'Save template');
  return providerInstalled ? t('invoices:editor.sendInvoice', 'Send invoice') : t('invoices:editor.saveInvoice', 'Save invoice');
}

export function EditorHeader({
  kind,
  name,
  lang,
  languages,
  status,
  error,
  canUndo,
  canRedo,
  addingLang,
  providerInstalled,
  onNameFocus,
  onNameChange,
  onOpenLanguage,
  onCreateLanguage,
  onUndo,
  onRedo,
  onImages,
  onDuplicate,
  onDelete,
  onPrimary,
  askAssistant,
  ref,
}: EditorHeaderProps) {
  const isTemplate = kind === 'template';
  const sends = !isTemplate && providerInstalled;
  return (
    <header
      ref={ref}
      data-testid="invoices-editor-header"
      className="sticky top-[var(--adm-topbar-h,0px)] z-20 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-[22px] py-3 backdrop-blur-[8px]"
    >
      <div className="flex min-w-[120px] flex-[0_1_auto] items-center gap-[9px] overflow-hidden">
        <Tag tone="neutral" className="shrink-0 gap-[5px] rounded-[20px] px-[9px] py-[3px] text-[10.5px]">
          {isTemplate ? <LayoutTemplate className="size-3" aria-hidden="true" /> : <FileText className="size-3" aria-hidden="true" />}
          {isTemplate ? t('invoices:editor.kind.template', 'Template') : t('invoices:editor.kind.invoice', 'Invoice')}
        </Tag>
        <input
          data-testid="invoices-editor-name"
          aria-label={t('invoices:editor.nameLabel', 'Name')}
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
      {/* The header wraps (`flex-wrap` above); this group has to wrap with it. Held on one
          line it measured 471 px inside a 390 px viewport and made the whole SHELL scroll
          sideways — the group is only ever one row at the comp's desktop width (328-362). */}
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
        <div className="flex gap-0.5 rounded-[9px] border border-border bg-surface-2 p-[3px]">
          <IconButton variant="ghost" size="md" label={t('invoices:editor.undo', 'Undo')} onClick={onUndo} disabled={!canUndo} data-testid="invoices-undo">
            <Undo2 className="size-[15px]" />
          </IconButton>
          <IconButton variant="ghost" size="md" label={t('invoices:editor.redo', 'Redo')} onClick={onRedo} disabled={!canRedo} data-testid="invoices-redo">
            <Redo2 className="size-[15px]" />
          </IconButton>
        </div>
        {askAssistant}
        <LanguageMenu current={lang} languages={languages} adding={addingLang} onOpen={onOpenLanguage} onCreate={onCreateLanguage} />
        <IconButton variant="bordered" size="xl" label={t('invoices:editor.images', 'Images')} tooltip onClick={onImages} data-testid="invoices-images">
          <Image className="size-4" />
        </IconButton>
        <IconButton variant="bordered" size="xl" label={t('invoices:editor.duplicate', 'Duplicate')} tooltip onClick={onDuplicate} data-testid="invoices-duplicate">
          <Copy className="size-4" />
        </IconButton>
        <IconButton variant="bordered" size="xl" label={t('invoices:editor.delete', 'Delete')} tooltip onClick={onDelete} data-testid="invoices-delete">
          <Trash2 className="size-4" />
        </IconButton>
        <Button iconLeft={sends ? <Send /> : <Save />} onClick={onPrimary} disabled={status === 'saving'} data-testid="invoices-save">
          {primaryLabel(kind, providerInstalled)}
        </Button>
      </div>
    </header>
  );
}
