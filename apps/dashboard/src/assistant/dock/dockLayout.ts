// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the panel stands beside the page: docked, over it, or as a sheet.
 *
 * MEASURED, NOT A BREAKPOINT. What decides is the room the PAGE would be left
 * with, and that depends on the rail (expanded, collapsed, or a drawer) as
 * much as on the window. With the rail expanded the switch falls at 1280, as
 * the comp draws it (Milo Panel, sections 03 and 04); with it collapsed the
 * panel can stay docked on a narrower window, because the page still has its
 * width.
 *
 * WITH HYSTERESIS. A window dragged across the edge would otherwise flip the
 * layout on every pixel, and each flip moves the page.
 */

/** The panel's width, in every layout but the sheet. */
export const DOCK_WIDTH = 400;
/** The narrowest a page may be left beside a docked panel. */
export const PAGE_MIN_WIDTH = 640;
/** Below this window width the panel is a sheet from the bottom edge. */
export const SHEET_BELOW = 640;
/** How far past the edge the room must go before the layout changes back. */
export const DOCK_HYSTERESIS = 24;

export type DockLayout = 'docked' | 'over' | 'sheet';

export function dockLayout(input: {
  /** The window's width. */
  viewport: number;
  /** The width the page column and the panel share: the window less the rail. */
  room: number;
  /** The layout now, when there is one: the edge is sticky in its favour. */
  previous?: DockLayout | undefined;
}): DockLayout {
  if (input.viewport < SHEET_BELOW) return 'sheet';
  const edge = PAGE_MIN_WIDTH + DOCK_WIDTH;
  if (input.previous === 'docked') return input.room >= edge - DOCK_HYSTERESIS ? 'docked' : 'over';
  if (input.previous === 'over') return input.room >= edge + DOCK_HYSTERESIS ? 'docked' : 'over';
  return input.room >= edge ? 'docked' : 'over';
}
