// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether the Designer looks at the page it built.
 *
 * After a build the previewed screen measures what is broken on it and draws
 * a picture of itself; this page sends both to the server, and the turn that
 * built the screen reads them. A person can switch it off: the choice is
 * kept in this browser, and a turn started with it off waits for nothing.
 */
import { tidyPagePath } from './pagePath.js';

const KEY = 'adminium.designer.sees';

/** On unless a person switched it off here. */
export function seesPage(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSeesPage(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, 'off');
  } catch {
    // A browser that keeps nothing: the choice holds for this page only.
  }
}

/** One thing a screen measured on itself: a kind and a few values. The server knows the kinds and writes the words. */
export type PageFault = Record<string, string | number>;

/** Which side the preview on this page shows now; null when no preview is open. Set by the preview itself. */
let shown: 'dashboard' | 'staff' | 'customer' | null = null;
export function previewShows(side: 'dashboard' | 'staff' | 'customer' | null): void {
  shown = side;
}

/**
 * Whether a turn started from the build page will be shown its screen: the
 * person lets it, and the preview is open on one of the app's own sides. On
 * the Dashboard tab there is no screen of the app's to look at, and a turn
 * told otherwise would wait for a picture that never comes.
 */
export function looksNow(): boolean {
  return seesPage() && (shown === 'staff' || shown === 'customer');
}

export interface PageSight {
  side: 'staff' | 'customer';
  width: number;
  faults: PageFault[];
  picture?: string;
  /** The page the screen was on, tidied. Left out when the screen said none, or something that is no path. */
  path?: string;
}

/** What a previewed screen posted, as a sight of the app's page; null when it is not one. */
export function sightFrom(data: unknown, appKey: string): PageSight | null {
  const said = data as { type?: unknown; app?: unknown; side?: unknown; width?: unknown; faults?: unknown; picture?: unknown; path?: unknown } | null;
  if (said === null || typeof said !== 'object' || said.type !== 'adminium:side-sight' || said.app !== appKey) return null;
  if (said.side !== 'staff' && said.side !== 'customer') return null;
  if (typeof said.width !== 'number' || !Number.isInteger(said.width) || said.width < 200 || said.width > 6000) return null;
  const faults = (Array.isArray(said.faults) ? said.faults : [])
    .filter((fault): fault is Record<string, unknown> => fault !== null && typeof fault === 'object' && typeof (fault as { kind?: unknown }).kind === 'string')
    // Only plain values go on: a kind, a count, a short name.
    .map((fault) => Object.fromEntries(Object.entries(fault).filter((entry): entry is [string, string | number] => (typeof entry[1] === 'string' && entry[1].length <= 200) || typeof entry[1] === 'number')))
    .slice(0, 40);
  const picture = typeof said.picture === 'string' && said.picture.startsWith('data:image/jpeg;base64,') && said.picture.length <= 1_000_000 ? said.picture : undefined;
  // Shown to the person in the chat ("Looked at /menu"), so it is held to a path's own shape here too.
  const path = typeof said.path === 'string' && said.path.startsWith('/') ? tidyPagePath(said.path) : null;
  return { side: said.side, width: said.width, faults, ...(picture === undefined ? {} : { picture }), ...(path === null ? {} : { path }) };
}
