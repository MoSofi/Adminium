// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data kit's layout parts that are not the project kit's as they stand:
 * a grid with a side column, a sheet that comes up from the bottom on a
 * phone, and a bar that stays at the foot of the page.
 *
 * An add-on's bundle ships no stylesheet of its own — a class only its page
 * uses is in no CSS the dashboard builds — so every layout a page needs is
 * one of these parts, grown by a prop when a page needs more.
 */
import type { ComponentProps, ReactNode } from 'react';
import { Sheet as UiSheet, cn } from '@adminium/ui';
import type { GridProps as ProjectGridProps } from '@adminium/server/ui';

import { Grid as ProjectGrid } from '../../project/kit/layout.js';

export interface GridProps extends ProjectGridProps {
  /**
   * A side column beside the grid: a summary, a "try it" card. It stays in
   * view while the main column scrolls, and moves under it below 1024 px.
   */
  aside?: ReactNode;
}

/** The project kit's grid; with `aside`, a main column of that grid and a sticky side column. */
export function Grid({ aside, ...grid }: GridProps): ReactNode {
  if (aside === undefined) return <ProjectGrid {...grid} />;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" data-part="kit-grid-aside">
      <ProjectGrid {...grid} />
      <aside className="min-w-0 lg:sticky lg:top-4">{aside}</aside>
    </div>
  );
}

/**
 * The dashboard's sheet. Under 640 px it is a bottom sheet: as tall as what
 * it holds, flush with the foot and the sides of the screen, where a thumb
 * reaches its buttons.
 */
export function Sheet({ className, ...props }: ComponentProps<typeof UiSheet>): ReactNode {
  return (
    <UiSheet
      {...props}
      className={cn('max-sm:-mx-[22px] max-sm:-mb-[22px] max-sm:max-h-[calc(100%+22px)] max-sm:flex-none max-sm:self-end max-sm:rounded-b-none max-sm:w-[calc(100%+44px)]', className)}
    />
  );
}

export interface StickyBarProps {
  /** What the bar says: a totals line, a count. */
  start?: ReactNode;
  /** Its buttons; the primary one last. */
  end?: ReactNode;
  /** Anything across the bar's whole width, above the two ends: a refusal. */
  children?: ReactNode;
  /** The bar's name for a screen reader, when what it holds does not say. */
  'aria-label'?: string;
}

/**
 * A bar that stays at the foot of the page while the page scrolls under it.
 * A solid surface, never a tint: a translucent bar's contrast would depend on
 * what happens to be scrolled behind it.
 */
export function StickyBar({ start, end, children, 'aria-label': label }: StickyBarProps): ReactNode {
  return (
    <div
      role="group"
      {...(label === undefined ? {} : { 'aria-label': label })}
      data-part="kit-sticky-bar"
      className="sticky bottom-0 z-20 -mx-6 mt-auto flex flex-col gap-2 border-t border-border bg-surface px-6 py-3.5"
    >
      {children}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-body-sm text-fg">{start}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{end}</div>
      </div>
    </div>
  );
}
