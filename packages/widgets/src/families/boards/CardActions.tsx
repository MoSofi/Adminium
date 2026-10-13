// SPDX-License-Identifier: AGPL-3.0-only
import { Ellipsis } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useMaybeT } from '../../lib/i18n.js';

import type { BoardCardAction } from './board-lib.js';

/**
 * A card's own actions: a small "more" button at the card's far corner and
 * the menu it opens ("Close: won or lost…", "Hand it over…").
 *
 * BESIDE THE CARD, NOT IN IT. The card is itself a button (it is picked up,
 * dragged, opened), and a button inside a button is one a screen reader
 * cannot reach. So this stands after the card in the page, drawn over its
 * corner: Tab goes to the card and then here, no key pressed here is the
 * card's (Enter does not pick the card up), and no pointer press here starts
 * a drag, because the drag's listeners are the card's and this is not in it.
 *
 * THE MENU IS NOT CLIPPED BY ITS COLUMN. A column scrolls, and a menu drawn
 * in it would be cut off at the column's foot. It is placed against the
 * window instead (`position: fixed`), under the button where there is room
 * and above it where there is none, its far edge on the button's far edge, so
 * it opens toward the start of the line in either direction of writing. It
 * stays in the board's own element, so the board's styles reach it. A scroll
 * that moves the button puts it away: it would otherwise hang where the
 * button no longer is. (One that leaves the button where it is does not: the
 * browser's own scroll to a button that has just taken the focus is heard a
 * moment after the key that opened the menu.)
 *
 * The keys are a menu's: the arrows go from item to item and round, Home and
 * End to the first and the last, Enter or space choose, Escape closes and the
 * focus goes back to the button, Tab closes and goes on.
 */

/** Room kept between the menu and the window's edge, and between the menu and its button. */
const EDGE = 8;
const GAP = 4;

export interface CardActionsProps {
  /** The card's title: the button and the menu are named after it. */
  title: string;
  actions: readonly BoardCardAction[];
  onAction: (actionId: string) => void;
  className?: string | undefined;
}

export function CardActions({ title, actions, onAction, className }: CardActionsProps) {
  const t = useMaybeT();
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Which item the menu opens on: the first, or the last when it was opened with the up arrow.
  const [open, setOpen] = useState<'first' | 'last' | null>(null);
  // Where the button was when the menu was placed.
  const placedAt = useRef<{ top: number; left: number } | null>(null);
  const label = t('ui:widgets.boards.cardActions', 'Actions for {title}', { title });

  const items = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const close = useCallback((refocus: boolean) => {
    setOpen(null);
    if (refocus) button.current?.focus();
  }, []);

  // Placed once it is drawn, when its own size is known; and the focus goes into it.
  useLayoutEffect(() => {
    const el = menu.current;
    const anchor = button.current;
    if (open === null || el === null || anchor === null) return;
    // Where `fixed` counts from. The window, unless something round the board moves its children by a
    // transform (a dashboard's grid does): the menu is drawn at 0,0 first and says where that is.
    el.style.top = '0px';
    el.style.left = '0px';
    const origin = el.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    placedAt.current = { top: at.top, left: at.left };
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    const wide = document.documentElement.clientWidth;
    const high = document.documentElement.clientHeight;
    const left = Math.max(EDGE, Math.min(rtl ? at.left : at.right - origin.width, wide - origin.width - EDGE));
    const below = at.bottom + GAP;
    const top = below + origin.height + EDGE <= high ? below : Math.max(EDGE, at.top - GAP - origin.height);
    el.style.top = `${String(Math.round(top - origin.top))}px`;
    el.style.left = `${String(Math.round(left - origin.left))}px`;
    el.style.visibility = 'visible';
    const all = items();
    (open === 'last' ? all[all.length - 1] : all[0])?.focus();
  }, [open]);

  // A press anywhere else puts the menu away; so does a scroll, or a window of another size, that moves the button.
  useEffect(() => {
    if (open === null) return undefined;
    const away = (event: Event): void => {
      const target = event.target as Node | null;
      if (target !== null && (menu.current?.contains(target) === true || button.current?.contains(target) === true)) return;
      close(false);
    };
    const moved = (): void => {
      const was = placedAt.current;
      const now = button.current?.getBoundingClientRect();
      if (was !== null && now !== undefined && Math.abs(now.top - was.top) < 1 && Math.abs(now.left - was.left) < 1) return;
      close(false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, [open, close]);

  const onButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The menu's own Escape: a card that is held, or a dialog round the board, does not hear it.
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      // On from the button, as if the menu had not been there.
      button.current?.focus();
      setOpen(null);
      return;
    }
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    let to: number;
    switch (event.key) {
      case 'ArrowDown':
        to = (at + 1) % all.length;
        break;
      case 'ArrowUp':
        to = (at + all.length - 1) % all.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = all.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    all[to]?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        data-part="board-card-actions"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        {...(open === null ? {} : { 'aria-controls': menuId })}
        onClick={() => setOpen((now) => (now === null ? 'first' : null))}
        onKeyDown={onButtonKeyDown}
        className={
          (className ?? '') +
          ' flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent aria-expanded:bg-surface-3 aria-expanded:text-fg'
        }
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </button>
      {open === null ? null : (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          data-part="board-card-menu"
          onKeyDown={onMenuKeyDown}
          // Against the window, and out of sight until it has been placed (the effect above, before anything is painted).
          className="invisible fixed z-50 flex min-w-40 max-w-64 flex-col gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-menu"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-action={action.id}
              // Still reached by the arrows, so a screen reader says it is there and not to be had; a press does nothing.
              aria-disabled={action.disabled === true ? true : undefined}
              onClick={() => {
                if (action.disabled === true) return;
                close(true);
                onAction(action.id);
              }}
              className={
                'w-full rounded-md px-2.5 py-1.5 text-start text-body-sm hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ' +
                (action.tone === 'danger' ? 'text-danger' : 'text-fg')
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
