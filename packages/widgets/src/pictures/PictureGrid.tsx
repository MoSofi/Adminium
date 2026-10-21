// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE GRID OF PICTURES EVERY PICKER DRAWS. One keyboard model, whoever hosts
 * it: a `listbox` with one tab stop and a roving focus; the arrows move (the
 * sideways ones flip right to left), Up and Down by a row, Home and End to
 * the ends; Enter or a click activates a tile (the host says what that does:
 * the dashboard's field chooses or ticks it, the Designer opens its details);
 * Space ticks one only where several may be ticked.
 *
 * Two looks, one per host, each kept for its own place:
 *  - `caption: 'under'`: a square thumbnail with its name under it (the
 *    dashboard's field);
 *  - `caption: 'over'`: a picture in the spot's own shape (`aspect`) with its
 *    title over its foot, shown on hover and focus (the Designer).
 * Every picture is `alt=""`: the tile's own name says what it is.
 */
import { Check, FileText } from 'lucide-react';
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface GridTile {
  id: string;
  /** Same-origin address of its picture. */
  src: string;
  /** What a screen reader says of the tile. */
  name: string;
  /** The first line of its caption. */
  title: string;
  /** The second line, under a caption under the picture: a file's name or its size, set in mono. */
  sub?: string | undefined;
  /** The first line is a file's name too, set in mono. */
  monoTitle?: boolean | undefined;
  /** Why it cannot be chosen, under its caption; its picture is then drawn as the file's kind. */
  refusal?: { id: string; text: string; kind: string } | undefined;
  /** It cannot be chosen now. */
  off?: boolean | undefined;
  /** Ticked, where several may be. */
  on?: boolean | undefined;
  /** Its details are open beside the grid. */
  open?: boolean | undefined;
}

export type GridAspect = 'square' | 'wide' | 'tall' | 'any';
const ASPECT: Readonly<Record<GridAspect, string>> = { square: 'aspect-square', wide: 'aspect-[16/10]', tall: 'aspect-[3/4]', any: 'aspect-[4/3]' };

export interface PictureGridProps {
  tiles: readonly GridTile[];
  /** The list's own name: "Pictures", "Pictures for Hero". */
  label: string;
  /** The pictures' shape: a field's square thumbnails, or the shape of the spot a picture is for. */
  aspect: GridAspect;
  caption: 'under' | 'over';
  cols: 3 | 4;
  /** Several may be ticked: Space ticks, and each tile shows its tick. */
  multiple: boolean;
  /** The tile that holds the one tab stop. */
  focus: number;
  onFocus: (index: number) => void;
  /** Enter, a click, or Space where several may be ticked. */
  onActivate: (index: number) => void;
  /** Ids for the tiles, so a host can put focus back on one. */
  idOf?: ((index: number) => string) | undefined;
}

export function PictureGrid({ tiles, label, aspect, caption, cols, multiple, focus, onFocus, onActivate, idOf }: PictureGridProps): ReactNode {
  const grid = useRef<HTMLUListElement>(null);
  const at = Math.min(focus, Math.max(0, tiles.length - 1));
  const onKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (tiles.length === 0) return;
    // By the page's own direction: what the styles say, else the nearest `dir`.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl' || event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    let next = at;
    switch (event.key) {
      case 'ArrowRight':
        next += rtl ? -1 : 1;
        break;
      case 'ArrowLeft':
        next += rtl ? 1 : -1;
        break;
      case 'ArrowDown':
        next += cols;
        break;
      case 'ArrowUp':
        next -= cols;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tiles.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        // Space ticks; Enter activates (chooses, ticks or opens, as the host says).
        if (event.key === ' ' && !multiple) return;
        onActivate(at);
        return;
      default:
        return;
    }
    event.preventDefault();
    next = Math.max(0, Math.min(tiles.length - 1, next));
    onFocus(next);
    grid.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };
  const gap = caption === 'over' ? (cols === 3 ? 'gap-2' : 'gap-2.5') : cols === 3 ? 'gap-x-2.5 gap-y-3' : 'gap-x-3.5 gap-y-4';
  return (
    <ul
      ref={grid}
      role="listbox"
      aria-label={label}
      aria-multiselectable={multiple ? true : undefined}
      onKeyDown={onKey}
      data-part="picker-grid"
      className={`m-0 grid list-none p-0 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-4'} ${gap}`}
    >
      {tiles.map((tile, index) => {
        const refused = tile.refusal !== undefined;
        return (
          <li
            key={tile.id}
            id={idOf?.(index)}
            role="option"
            aria-label={tile.name}
            aria-selected={multiple ? tile.on === true : tile.open === true}
            aria-disabled={tile.off === true ? true : undefined}
            aria-describedby={tile.refusal?.id}
            tabIndex={index === at ? 0 : -1}
            onFocus={() => onFocus(index)}
            onClick={() => onActivate(index)}
            data-part="picker-tile"
            className={`group flex min-w-0 flex-col gap-[7px] outline-none ${tile.off === true ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`relative block w-full overflow-hidden rounded-md bg-surface-3 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${ASPECT[aspect]} ${tile.on === true || tile.open === true ? 'ring-2 ring-accent' : ''}`}
            >
              {refused ? (
                <span aria-hidden className="flex size-full flex-col items-center justify-center gap-1.5 text-fg-subtle opacity-55">
                  <FileText className="size-[26px]" />
                  <span className="font-mono text-[11px] font-bold">{tile.refusal?.kind}</span>
                </span>
              ) : (
                <img src={tile.src} alt="" loading="lazy" className={`block size-full object-cover ${tile.off === true ? 'opacity-40' : ''}`} />
              )}
              {multiple && !refused ? (
                <span
                  aria-hidden
                  className={`absolute end-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white text-accent-fg ${tile.on === true ? 'bg-accent' : 'bg-black/35'} ${tile.off === true ? 'opacity-50' : ''}`}
                >
                  {tile.on === true ? <Check className="size-[13px]" /> : null}
                </span>
              ) : null}
              {caption === 'over' ? (
                <span
                  aria-hidden
                  data-part="picker-caption"
                  className="pointer-events-none absolute inset-x-1.5 bottom-1.5 truncate rounded-[6px] bg-[rgba(15,15,20,.86)] px-2 py-1 text-start text-caption font-bold leading-[1.4] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {tile.title}
                </span>
              ) : null}
            </span>
            {caption === 'under' ? (
              <span className="flex min-w-0 flex-col gap-px">
                <span className={`truncate ${tile.monoTitle === true ? 'font-mono text-xs font-semibold' : 'text-body-sm font-bold'} ${tile.off === true ? 'text-fg-muted' : 'text-fg'}`}>{tile.title}</span>
                {tile.sub === undefined ? null : <span className="truncate font-mono text-caption text-fg-muted">{tile.sub}</span>}
                {refused ? (
                  <span id={tile.refusal?.id} className="mt-[3px] text-caption leading-[1.4] text-fg-muted">
                    {tile.refusal?.text}
                  </span>
                ) : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
