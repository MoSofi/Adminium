// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@staff` AND `@staff/<path>`: A PAGE LINK INTO ITS APP'S OWN STAFF SIDE.
 *
 * A console page's link (a toolbar link, a card's `href`) names `@staff` for
 * the app's staff screens wherever they live, and `@staff/<path>` for one
 * screen of them (`@staff/approvals`). The host joins the path to the side's
 * address: inside the dashboard (`/a/<app>/approvals`) or on the side's own
 * host. So the path is only ever a path INSIDE the side, the grammar of a
 * section entry's path (`isSidePath` in `@adminium/manifest`, which refuses
 * any other at install):
 *
 *  - segments of letters, digits and `-._~`, none starting with a dot (so no
 *    `.` and no `..`), none empty (no `//`, no leading or trailing `/`);
 *  - no scheme, no `:`, no `\`, no `%` (an encoded dot is a dot to a
 *    browser), no query and no `#`.
 *
 * Kept in its own module: only the dashboard template's lazy chunk reads it.
 */

/** The shortest link: the side's first screen. */
export const STAFF_LINK = '@staff';

const SEGMENT = '[A-Za-z0-9_~-][A-Za-z0-9._~-]*';
const STAFF_PATH = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`);

/**
 * The path inside the staff side an `@staff` link names: `''` for `@staff`
 * itself, `approvals` for `@staff/approvals`, and null for anything else
 * (another `@` address, or a path that could leave the side).
 */
export function staffLinkPath(href: string): string | null {
  if (href === STAFF_LINK) return '';
  if (!href.startsWith(`${STAFF_LINK}/`)) return null;
  const path = href.slice(STAFF_LINK.length + 1);
  return path.length <= 200 && STAFF_PATH.test(path) ? path : null;
}
