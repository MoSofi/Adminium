// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A text of the canvas, with its placeholders (comp `Milo Automations`, 7a
 * and 7b).
 *
 * In the editor each `{{name}}` is a chip: it opens a small dialog that asks
 * what to write when the value is missing, and shows the sentence with it.
 * With *Preview with missing values* on, the text is written as a reader with
 * no values meets it. Anywhere else (a read-only preview) it is the text as
 * stored, as it always was.
 */
import { createContext, useContext, useId, useState } from 'react';
import { Input, Popover, PopoverContent, PopoverTrigger, cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { fillPlaceholders, placeholdersIn, spokenName, withBackup } from '../../model/placeholders.js';

/** Where a text lives in its block's data: `['paras', 1]`, `['text']`. */
export type TextPath = readonly (string | number)[];

export interface CanvasTextScope {
  /** Draw every text as a reader with no values meets it. */
  missing: boolean;
  /** Write a text back; absent in a preview, where nothing is edited. */
  onText?: ((path: TextPath, value: string) => void) | undefined;
  /** A chip's field was opened: one undo step begins. */
  onEditStart?: (() => void) | undefined;
}

export const CanvasText = createContext<CanvasTextScope>({ missing: false });

function Chip({ text, index, path, scope }: { text: string; index: number; path: TextPath; scope: CanvasTextScope }) {
  const placeholder = placeholdersIn(text)[index];
  const [open, setOpen] = useState(false);
  const field = useId();
  if (placeholder === undefined) return null;
  const spoken = spokenName(placeholder.name);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) scope.onEditStart?.();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="email-placeholder-chip"
          data-name={placeholder.name}
          aria-haspopup="dialog"
          aria-label={
            placeholder.backup === undefined
              ? t('email:missing.chip', '{name}: say what to write when it is missing', { name: placeholder.name })
              : t('email:missing.chipWith', '{name}: when it is missing, “{backup}” is written', { name: placeholder.name, backup: placeholder.backup })
          }
          className={cn(
            'mx-px inline-flex cursor-pointer items-center rounded-lg border-[1.5px] border-[var(--adm-email-accent)] px-[9px] py-px align-baseline font-mono text-[.94em] font-semibold',
            open ? 'bg-[var(--adm-email-accent)] text-white' : 'bg-[color-mix(in_srgb,var(--adm-email-accent)_10%,transparent)] text-[var(--adm-email-accent)]',
          )}
        >
          {`{{${placeholder.name}}}`}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        align="start"
        aria-label={t('email:missing.dialog', 'Backup text for {name}', { name: placeholder.name })}
        data-testid="email-backup-dialog"
        className="w-[290px] rounded-[14px] p-3.5"
        onClick={(event) => event.stopPropagation()}
      >
        <label htmlFor={field} className="mb-1.5 block text-[12px] font-bold text-fg">
          {t('email:missing.ask', 'If there is no {name}, write:', { name: spoken })}
        </label>
        <Input
          id={field}
          autoFocus
          data-testid="email-backup-input"
          value={placeholder.backup ?? ''}
          onChange={(event) => scope.onText?.(path, withBackup(text, index, event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setOpen(false);
          }}
        />
        <div className="mt-2.5 rounded-lg bg-surface-2 px-2.5 py-2">
          <span className="block text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('email:missing.preview', 'Preview')}</span>
          <span data-testid="email-backup-preview" className="mt-0.5 block whitespace-pre-wrap text-[12.5px] text-fg">
            {fillPlaceholders(text, {})}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One text of a block. `path` says where it is kept, so a chip can write its backup back. */
export function Filled({ text, path }: { text: string; path: TextPath }) {
  const scope = useContext(CanvasText);
  if (scope.missing) return <>{fillPlaceholders(text, {})}</>;
  const found = scope.onText === undefined ? [] : placeholdersIn(text);
  if (found.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  found.forEach((placeholder, index) => {
    if (placeholder.at > cursor) parts.push(text.slice(cursor, placeholder.at));
    parts.push(<Chip key={`${String(index)}:${placeholder.name}`} text={text} index={index} path={path} scope={scope} />);
    cursor = placeholder.at + placeholder.whole.length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
