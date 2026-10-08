// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "More", at the end of the work bar: what the bar had no room left for.
 * Past its first fold that is the camera switch; in two rows it is also the
 * side, whose eyes the preview is, and "Open in a new tab".
 */
import type { ReactNode } from 'react';
import { Camera, Check, Ellipsis, ExternalLink, Eye } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { SideRows, type SideChoice } from './sideChoices.js';

/** A row of this menu: 13 px, its words free to wrap. */
export const MENU_ROW = 'gap-[9px] rounded-[8px] px-2.5 py-[9px] text-[13px] font-semibold leading-[1.4] [&>span]:overflow-visible [&>span]:whitespace-normal [&_svg]:size-[15px]';
export const MENU_PANEL = 'rounded-[12px] p-[5px] leading-[normal]';
export const TOOL_ICON = 'flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent';

export function MoreMenu({
  rows,
  sides,
  side,
  onSide,
  seen,
  sees,
  onSees,
  onNewTab,
}: {
  /** The bar is in two rows: the side, the eyes and the new tab are in here too. */
  rows: boolean;
  sides: readonly SideChoice[];
  side: string;
  onSide: (side: string) => void;
  seen: { label: string; tip: string } | null;
  sees: boolean;
  onSees: (on: boolean) => void;
  onNewTab: () => void;
}): ReactNode {
  const label = t('designer:preview.more', 'More');
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={label}>
        <DropdownMenuTrigger aria-label={label} className={TOOL_ICON}>
          <Ellipsis aria-hidden="true" className="size-[15px]" />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className={`${MENU_PANEL} ${rows ? 'w-[290px]' : 'w-[300px]'} max-w-[calc(100vw-16px)]`}>
        {rows && sides.length > 1 ? (
          <>
            <DropdownMenuLabel>{t('designer:preview.side', 'Side')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={side} onValueChange={onSide}>
              <SideRows sides={sides} />
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {rows && seen !== null ? (
          <>
            <div className="flex items-start gap-[9px] px-2.5 py-[9px]">
              <Eye aria-hidden="true" className="mt-px size-[15px] shrink-0 text-fg-muted" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold text-fg">{seen.label}</span>
                <span className="text-[12px] leading-[1.45] text-fg-muted">{seen.tip}</span>
              </span>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={sees}
          icon={<Camera />}
          trailing={<Check aria-hidden="true" className={sees ? 'text-accent' : 'invisible'} />}
          // The switch is the menu's own: it stays open, so the tick is seen to change.
          onSelect={(event) => {
            event.preventDefault();
            onSees(!sees);
          }}
          className={MENU_ROW}
        >
          {t('designer:preview.sees', 'The Designer looks at the page after it builds')}
        </DropdownMenuItem>
        {rows ? (
          <DropdownMenuItem icon={<ExternalLink className="rtl:-scale-x-100" />} onSelect={onNewTab} className={MENU_ROW}>
            {t('designer:preview.newTab', 'Open in a new tab')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
