// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Change the look", under the last turn once the app has screens of its
 * own: the four directions, the one in use marked. Picking one costs no
 * turn and no tokens: the server writes the look to every side, builds,
 * applies and saves a version, and the preview shows it.
 */
import type { ReactNode } from 'react';
import { Check, ChevronDown, LoaderCircle, Palette } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { LOOK_DIRECTIONS, type LookDirection } from '../api.js';
import { lookLine, lookName, LookSwatch } from '../parts/look.js';

export function LookMenu({ current, pending, disabled, onPick }: { current: LookDirection; pending: boolean; disabled: boolean; onPick: (direction: LookDirection) => void }): ReactNode {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled || pending}
        className="inline-flex items-center gap-1.5 self-start rounded-[10px] border border-border-strong bg-surface px-3 py-[7px] text-[12.5px] font-bold text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" /> : <Palette aria-hidden="true" className="size-3.5 text-fg-muted" />}
        {pending ? t('designer:look.changing', 'Changing the look…') : t('designer:look.change', 'Change the look')}
        <ChevronDown aria-hidden="true" className="size-3.5 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[300px]">
        <DropdownMenuLabel>{t('designer:look.menu', 'The look of the screens')}</DropdownMenuLabel>
        {LOOK_DIRECTIONS.map((direction) => (
          <DropdownMenuItem
            key={direction}
            icon={<LookSwatch direction={direction} />}
            onSelect={() => (direction === current ? undefined : onPick(direction))}
            trailing={direction === current ? <Check aria-hidden="true" className="text-accent" /> : undefined}
          >
            <span className="flex min-w-0 flex-col py-0.5">
              <span>{lookName(direction)}</span>
              <span className="truncate text-[11.5px] font-normal text-fg-subtle">{lookLine(direction)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <p className="m-0 px-2.5 pb-1.5 pt-1 text-[11.5px] leading-snug text-fg-subtle">{t('designer:look.finer', 'For anything finer, say it in the chat: “darker, with gold”.')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
