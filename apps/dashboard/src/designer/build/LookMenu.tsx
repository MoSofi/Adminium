// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Change the style", under the last turn once the app has screens of its
 * own: every style there is, built in and the project's own, the one in use
 * marked. Picking one costs no turn and no tokens: the server writes it to
 * every side, builds, applies and saves a version, and the preview shows it.
 * A style of words alone has no values to write: it is asked for in the chat.
 * "Add your own…" is last: a style added here is in the list at once.
 */
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, LoaderCircle, Palette, Plus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { AppLook, DesignerStyle } from '../api.js';
import { AddStyleDialog, StyleTile } from '../parts/styles.js';

export function StyleMenu({
  current,
  styles,
  pending,
  disabled,
  onPick,
}: {
  current: AppLook;
  styles: readonly DesignerStyle[];
  pending: boolean;
  disabled: boolean;
  onPick: (key: string) => void;
}): ReactNode {
  const [adding, setAdding] = useState(false);
  // A look kept before styles is none of the list's: nothing is marked until a style is picked.
  const inUse = (style: DesignerStyle): boolean => current.origin !== 'earlier' && style.key === current.skill;
  const row = (style: DesignerStyle): ReactNode => {
    const unusable = style.problem !== undefined || !style.hasTheme;
    return (
      <DropdownMenuItem
        key={`${style.origin}:${style.key}`}
        icon={<StyleTile entry={style} />}
        disabled={unusable}
        onSelect={() => (inUse(style) || unusable ? undefined : onPick(style.key))}
        trailing={inUse(style) ? <Check aria-label={t('designer:style.inUse', 'In use')} className="text-accent" /> : undefined}
      >
        <span className="flex min-w-0 flex-col py-0.5">
          <span>{style.title}</span>
          <span className="whitespace-normal text-[11.5px] font-normal leading-snug text-fg-subtle">
            {style.problem !== undefined
              ? t('designer:style.problem', 'Cannot be used: {why}', { why: style.problem })
              : !style.hasTheme
                ? t('designer:style.wordsOnly', 'Applying this one takes a turn: ask for it in the chat.')
                : style.description}
          </span>
        </span>
      </DropdownMenuItem>
    );
  };
  const own = styles.filter((style) => style.origin === 'project');
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          disabled={disabled || pending}
          className="inline-flex items-center gap-1.5 self-start rounded-[10px] border border-border-strong bg-surface px-3 py-[7px] text-[12.5px] font-bold text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" /> : <Palette aria-hidden="true" className="size-3.5 text-fg-muted" />}
          {pending ? t('designer:style.changing', 'Changing the style…') : t('designer:style.change', 'Change the style')}
          {pending ? null : <span className="font-normal text-fg-muted">{current.title}</span>}
          <ChevronDown aria-hidden="true" className="size-3.5 text-fg-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[min(70vh,560px)] w-[340px] overflow-y-auto">
          <DropdownMenuLabel>{t('designer:style.menu', 'The style of the screens')}</DropdownMenuLabel>
          {styles.filter((style) => style.origin === 'built-in').map(row)}
          {own.length === 0 ? null : <DropdownMenuLabel>{t('designer:style.yours', 'Yours')}</DropdownMenuLabel>}
          {own.map(row)}
          <p className="m-0 px-2.5 pb-1.5 pt-1 text-[11.5px] leading-snug text-fg-subtle">{t('designer:style.finer', 'For anything finer, say it in the chat: “darker, with gold”.')}</p>
          <DropdownMenuItem icon={<Plus />} onSelect={() => setAdding(true)}>
            {t('designer:style.addOwn', 'Add your own…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddStyleDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
