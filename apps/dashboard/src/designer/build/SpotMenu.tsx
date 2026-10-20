// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a click on a picture spot meant, asked while pointing: change its
 * picture (the picture dialog, on that spot), or point at it as at any other
 * element. Drawn by this page over the preview's frame, 14px inside the
 * spot's top-start corner, since the frame is another site.
 *
 * Focus goes to the first item; the arrows move between the two; Escape or
 * a click outside closes it, and focus goes back to the frame.
 */
import { Crosshair, Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import type { SpotPick } from './picked.js';

const WIDTH = 224;
const INSET = 14;

export function SpotMenu({
  pick,
  label,
  frame,
  onChange,
  onPoint,
  onClose,
}: {
  pick: SpotPick;
  /** The spot's name, as the dialog lists it. */
  label: string;
  /** The frame the spot is drawn in: where the menu goes, and where focus goes back to. */
  frame: HTMLIFrameElement | null;
  onChange: () => void;
  onPoint: () => void;
  onClose: () => void;
}): ReactNode {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After the frame that draws it, as every menu of the product moves focus.
    const id = window.setTimeout(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 40);
    const outside = (event: PointerEvent): void => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [onClose]);

  // Where the spot is on this page: the frame's place, and its scale where the preview draws it smaller.
  // (Drawn in the preview's own panel, beside the frame: that panel is what it is placed in.)
  const holder = menu.current?.offsetParent ?? frame?.closest('[role="tabpanel"]') ?? null;
  const at = frame?.getBoundingClientRect();
  const base = holder?.getBoundingClientRect();
  const scale = frame !== null && frame.offsetWidth > 0 && at !== undefined ? at.width / frame.offsetWidth : 1;
  const rtl = (frame?.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir) === 'rtl';
  const box = pick.box ?? { x: 0, y: 0, width: 0, height: 0 };
  const left = (at?.left ?? 0) - (base?.left ?? 0) + (rtl ? (box.x + box.width - INSET) * scale - WIDTH : (box.x + INSET) * scale);
  const top = (at?.top ?? 0) - (base?.top ?? 0) + (box.y + INSET) * scale;
  // Placed from the holder's own start edge, so the page's direction is followed.
  const start = holder !== null && getComputedStyle(holder).direction === 'rtl' ? (base?.width ?? 0) - left - WIDTH : left;

  const close = (): void => {
    onClose();
    frame?.focus();
  };
  const item = 'flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-start text-[13px] font-bold text-fg outline-none hover:bg-surface-2 focus-visible:bg-surface-2';
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      data-part="spot-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const now = items.indexOf(document.activeElement as HTMLElement);
        items[(now + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}
      style={{ '--spot-x': `${String(Math.round(Math.max(4, start)))}px`, '--spot-y': `${String(Math.round(Math.max(4, top)))}px` }}
      className="absolute start-[var(--spot-x)] top-[var(--spot-y)] z-20 flex w-[224px] flex-col rounded-[10px] border border-border bg-surface p-[5px] shadow-modal"
    >
      <button type="button" role="menuitem" tabIndex={-1} onClick={onChange} className={item}>
        <ImageIcon aria-hidden="true" className="size-[15px] text-fg-muted" />
        {t('designer:spots.change', 'Change the picture…')}
      </button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={onPoint} className={item}>
        <Crosshair aria-hidden="true" className="size-[15px] text-fg-muted" />
        {t('designer:spots.point', 'Point at it')}
      </button>
    </div>
  );
}
