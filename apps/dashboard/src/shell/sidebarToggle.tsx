// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sidebar's one switch, and the two things it switches.
 *
 * At `lg` and up the rail sits beside the page, and the switch shows or hides
 * it there — a choice that is remembered, because someone who wants the room
 * wants it on the next visit too. Below `lg` there is no room beside the page,
 * so the rail used to simply vanish: `hidden lg:flex` with nothing to bring it
 * back, and a window dragged narrow lost the navigation outright. There the
 * same switch opens the rail as a drawer OVER the page instead, which closes
 * on the scrim, on Esc, and on the navigation it was opened for.
 *
 * One switch rather than two because the person sees one button (Topbar's
 * menu button) and one shortcut (⌘B); which of the two it moves is the
 * viewport's business, not theirs.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** Tailwind's `lg` — where AppShell's `lg:flex` puts the rail beside the page. */
export const WIDE_QUERY = '(min-width: 1024px)';
/** Per viewer, per browser: a layout convenience, never workspace state. */
export const SIDEBAR_STORAGE_KEY = 'adminium-sidebar';
/** `aria-controls` targets: the rail beside the page, and the one in the drawer. */
export const SIDEBAR_ID = 'app-sidebar';
export const SIDEBAR_DRAWER_ID = 'app-sidebar-drawer';

function subscribeWide(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Whether the rail has room beside the page. */
export function useWideViewport(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

function readRailOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'closed';
  } catch {
    // Blocked storage (a private window, site data refused) keeps the default.
    return true;
  }
}

function writeRailOpen(open: boolean): void {
  try {
    if (open) window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    else window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'closed');
  } catch {
    // Not remembering is the only cost.
  }
}

export interface SidebarToggle {
  /** The rail has room beside the page (`lg` and up). */
  wide: boolean;
  /** The rail beside the page is shown — meaningful when `wide`. */
  railOpen: boolean;
  /** The drawer is open — only ever true when not `wide`. */
  drawerOpen: boolean;
  /** What the menu button reports as `aria-expanded`. */
  expanded: boolean;
  /** The id the menu button controls, or null while that element is not in the page. */
  controls: string | null;
  toggle: () => void;
  setDrawerOpen: (open: boolean) => void;
}

/** @param location closes the drawer when it changes: following a link in it is what it was opened for. */
export function useSidebarToggle(location: string): SidebarToggle {
  const wide = useWideViewport();
  const [railOpen, setRailOpen] = useState(readRailOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location, wide]);

  const toggle = useCallback(() => {
    if (wide) {
      setRailOpen((open) => {
        writeRailOpen(!open);
        return !open;
      });
    } else {
      setDrawerOpen((open) => !open);
    }
  }, [wide]);

  const expanded = wide ? railOpen : drawerOpen;
  // The rail beside the page is always in the document (CSS hides it), the
  // drawer only while open — and an `aria-controls` naming an id that is not
  // there is an error, not a hint.
  const controls = wide ? SIDEBAR_ID : drawerOpen ? SIDEBAR_DRAWER_ID : null;
  return { wide, railOpen, drawerOpen: drawerOpen && !wide, expanded, controls, toggle, setDrawerOpen };
}
