// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dragging over the previewed page to take a picture of a part of it.
 *
 * Laid over the frame while it is on, so the drag is this page's own and
 * nothing in the frame sees it: the page under it stays as it was. The box
 * dragged is said in the frame's own pixels (the frame is never drawn scaled,
 * so they are this layer's too). Escape stops it, heard by the preview.
 */
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { areaBetween, type ShotArea } from './shot.js';

export function ShotOverlay({ drawing, onArea }: { /** The part was chosen and the page is drawing it. */ drawing: boolean; onArea: (area: ShotArea) => void }): ReactNode {
  const from = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<ShotArea | null>(null);

  const at = (event: PointerEvent<HTMLDivElement>): { point: { x: number; y: number }; width: number; height: number } => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, width: bounds.width, height: bounds.height };
  };
  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (drawing || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    from.current = at(event).point;
    setBox(null);
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (from.current === null) return;
    const here = at(event);
    setBox(areaBetween(from.current, here.point, here.width, here.height));
  };
  const up = (event: PointerEvent<HTMLDivElement>): void => {
    if (from.current === null) return;
    const here = at(event);
    const area = areaBetween(from.current, here.point, here.width, here.height);
    from.current = null;
    setBox(area);
    // A slip of the hand takes nothing, and the drag can be made again.
    if (area !== null) onArea(area);
  };

  return (
    <div
      data-part="shot-overlay"
      // The box is laid by the frame's own pixels from its left edge, whichever way the page around it reads.
      dir="ltr"
      role="img"
      aria-label={t('designer:shot.area', 'Drag over the part of the page to take a picture of')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        from.current = null;
        setBox(null);
      }}
      className={`absolute inset-0 z-[4] touch-none select-none overflow-hidden ${drawing ? 'cursor-progress' : 'cursor-crosshair'} ${box === null ? 'bg-black/10' : ''}`}
    >
      {box === null ? null : (
        // The part chosen stays clear; the rest of the page is dimmed by its shadow.
        <div
          data-part="shot-box"
          className="pointer-events-none absolute start-[var(--shot-left)] top-[var(--shot-top)] h-[var(--shot-height)] w-[var(--shot-width)] border-2 border-accent shadow-[0_0_0_9999px_rgb(0_0_0/0.28)]"
          style={{ '--shot-left': `${String(box.left)}px`, '--shot-top': `${String(box.top)}px`, '--shot-width': `${String(box.width)}px`, '--shot-height': `${String(box.height)}px` }}
        />
      )}
      {drawing ? (
        <span role="status" className="pointer-events-none absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-bold text-fg shadow-sm">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
          <span dir="auto">{t('designer:shot.drawing', 'Taking the picture…')}</span>
        </span>
      ) : null}
    </div>
  );
}
