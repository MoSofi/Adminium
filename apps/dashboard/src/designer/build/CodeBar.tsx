// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The work bar's end while the Code tab shows: where the open file is, whether
 * anything is unsaved, and the two things to do about it. "Save" keeps every
 * edited file in one version; "Discard changes" is the open file's alone.
 *
 * It narrows by itself: the path gives way from its start (the file's name is
 * kept), then "Unsaved changes" becomes its dot, then "Discard changes" goes
 * into a menu.
 */
import type { ReactNode } from 'react';
import { ChevronRight, Ellipsis, LoaderCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { crumbsOf, findFile, nameOf } from './fileTree.js';
import { MENU_PANEL, MENU_ROW, TOOL_ICON } from './MoreMenu.js';
import type { CodeFiles } from './useCodeFiles.js';

/** The save key as this machine's keyboard has it. */
export function saveKeyCap(): string {
  const platform = typeof navigator === 'undefined' ? '' : ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '');
  return /mac|iphone|ipad/i.test(platform) ? '⌘S' : 'Ctrl S';
}

const SMALL = 'inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 text-[12.5px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45';

export function CodeBarEnd({ code }: { code: CodeFiles }): ReactNode {
  const found = findFile(code.list, code.open);
  const crumbs = found === null ? [] : crumbsOf(found.group, found.file.label);
  const file = found === null ? '' : nameOf(found.file.label);
  const unsaved = code.marks.size > 0;
  const discardLabel = t('designer:code.discardFile', 'Discard changes to {file}', { file });
  const saveLabel = code.count > 1 ? t('designer:code.saveCount', 'Save {count} files', { count: code.count }) : t('designer:code.save', 'Save');

  return (
    <div className="@container flex min-w-0 flex-1 items-center gap-3">
      {/* Sized by its words, and cut from its start when there is no room: the last part is the file's name. */}
      <div dir="ltr" aria-label={t('designer:code.openFile', 'Open file')} className="flex min-w-0 shrink items-center justify-end gap-[3px] overflow-hidden whitespace-nowrap font-mono text-[12px] text-fg-muted">
        {crumbs.map((crumb, index) => (
          <span key={`${String(index)}.${crumb}`} className="flex shrink-0 items-center gap-[3px]">
            {index === 0 ? null : <ChevronRight aria-hidden="true" className="size-3 text-fg-subtle" />}
            <span className={index === crumbs.length - 1 ? 'font-semibold text-fg' : 'font-medium'}>{crumb}</span>
          </span>
        ))}
      </div>
      {unsaved ? (
        <span role="status" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-bold text-fg-muted">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-warn" />
          <span className="@max-[460px]:sr-only">{t('designer:code.unsaved', 'Unsaved changes')}</span>
        </span>
      ) : null}
      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={code.discard} disabled={!code.canDiscard} aria-label={discardLabel} className={`${SMALL} border border-transparent text-fg-muted hover:bg-surface-3 hover:text-fg @max-[340px]:hidden`}>
          {t('designer:code.discard', 'Discard changes')}
        </button>
        <DropdownMenu modal={false}>
          <Tooltip content={t('designer:preview.more', 'More')}>
            <DropdownMenuTrigger aria-label={t('designer:preview.more', 'More')} className={`${TOOL_ICON} hidden @max-[340px]:flex`}>
              <Ellipsis aria-hidden="true" className="size-[15px]" />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className={`${MENU_PANEL} w-[220px] max-w-[calc(100vw-16px)]`}>
            <DropdownMenuItem disabled={!code.canDiscard} onSelect={code.discard} aria-label={discardLabel} className={MENU_ROW}>
              {t('designer:code.discard', 'Discard changes')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" onClick={() => void code.save()} disabled={!code.canSave} aria-keyshortcuts="Control+S Meta+S" className={`${SMALL} bg-accent text-accent-fg shadow-glow hover:brightness-105 disabled:shadow-none`}>
          {code.saving ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {saveLabel}
          <kbd aria-hidden="true" className="rounded-[5px] bg-white/20 px-[5px] py-px font-mono text-[10.5px] font-semibold">
            {saveKeyCap()}
          </kbd>
        </button>
      </div>
    </div>
  );
}
