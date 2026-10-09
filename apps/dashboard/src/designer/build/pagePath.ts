// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page's path inside a side of the app, as the build page holds it.
 *
 * One shape, the same one the side's own script and the server keep: a path
 * is read part by part, a query and a hash are not part of it, empty parts
 * and the parts that climb are dropped, each part is decoded and then
 * encoded (so nothing is encoded twice), and it is at most 160 characters as
 * a person reads it. SYNC NOTE: `tidyPath` in the server's side module and
 * `cleanPagePath` beside the server's sights are the other two copies (the
 * dashboard may not import server code); the tests hold the three to the
 * same cases.
 */
export const PAGE_PATH_MAX = 160;

/** The one shape of a path, or null for what is no page's path. */
export function tidyPagePath(input: string): string | null {
  const parts: string[] = [];
  let length = 0;
  for (const part of (input.split(/[?#]/)[0] ?? '').split('/')) {
    let plain: string;
    try {
      plain = decodeURIComponent(part);
    } catch {
      // A percent sign that starts no escape is a character of the name.
      plain = part;
    }
    if (plain === '' || plain === '.' || plain === '..') continue;
    // A line end or another control character is in no page's address.
    if ([...plain].some((mark) => (mark.codePointAt(0) ?? 0) < 32 || mark === '\u007f')) return null;
    length += 1 + plain.length;
    parts.push(encodeURIComponent(plain));
  }
  return length > PAGE_PATH_MAX ? null : `/${parts.join('/')}`;
}

/** A path as a person reads it: `/menu/crème brûlée`, not its escapes. */
export function shownPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * What a person typed into the address bar, as a path of the side: nothing
 * typed is the first page, a missing first slash is added, and a whole
 * address loses its site and the side's own prefix. Null when it is no path.
 */
export function typedPagePath(typed: string, prefix: string): string | null {
  let text = typed.trim();
  const site = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(text);
  if (site !== null) text = text.slice(site[0].length);
  if (!text.startsWith('/')) text = `/${text}`;
  if (prefix !== '' && (text === prefix || text.startsWith(`${prefix}/`))) text = text.slice(prefix.length);
  return tidyPagePath(text);
}

/** Whether a path of the Designer's own name is the Designer itself: its own page is never shown inside its preview. */
export function isDesignerPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === '/design' || lower.startsWith('/design/');
}

/** A page's own title, as one short line. */
function plainLine(value: unknown): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
  return (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PAGE_PATH_MAX);
}

/**
 * What a previewed side said of where it is, when it is this app's and the
 * side being shown; null for anything else. Who said it (the preview's own
 * site, one of this page's frames) is the listener's to check.
 */
export function locationFrom(data: unknown, appKey: string, side: 'dashboard' | 'staff' | 'customer'): { path: string; title: string } | null {
  const said = data as { type?: unknown; app?: unknown; side?: unknown; path?: unknown; title?: unknown } | null;
  if (said === null || typeof said !== 'object' || said.type !== 'adminium:side-location') return null;
  if (said.app !== appKey || said.side !== side || side === 'dashboard') return null;
  if (typeof said.path !== 'string' || !/^\/[^\s\\]{0,299}$/.test(said.path)) return null;
  const path = tidyPagePath(said.path);
  return path === null ? null : { path, title: plainLine(said.title) };
}

export interface VisitedPage {
  path: string;
  title: string;
}

/** How many pages the list of opened pages keeps. */
export const VISITED_MAX = 30;

/** The pages a person has opened, newest first, with the first page always among them. */
export function visit(pages: readonly VisitedPage[], page: VisitedPage): VisitedPage[] {
  const next = [page, ...pages.filter((entry) => entry.path !== page.path)];
  const home = next.find((entry) => entry.path === '/') ?? { path: '/', title: '' };
  const kept = next.slice(0, VISITED_MAX);
  return kept.some((entry) => entry.path === '/') ? kept : [...kept.slice(0, VISITED_MAX - 1), home];
}
