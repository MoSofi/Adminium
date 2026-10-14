// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@staff` — AN APP'S OWN STAFF SCREENS AS A LINK TARGET.
 *
 * An app's Overview says "Open the desk". Where the desk is depends on how the
 * app was placed: inside the dashboard (`/a/<app>/…`) or on its own address.
 * A page's stored link cannot know that, so it names `@staff` and this
 * resolves it the way the sidebar's "Open the staff screens" does — the same
 * section, the same address — for the app that owns the page.
 *
 * `@staff/<path>` opens one screen of them (`@staff/approvals`): the path is
 * joined to the side's address, and one that could leave it (`..`, `//`, a
 * scheme, an encoded dot) names nothing (`staffLinkPath`).
 *
 * An app with no staff screens resolves to nothing, and the page draws no
 * link at all rather than one that goes nowhere.
 */
import { appPagesOf, appSectionsOf, hiddenPagesOf, type BootstrapData } from '../app/bootstrap.js';

export const STAFF_HREF = '@staff';

/** Where `@staff` goes for one page: a dashboard route, or an address of its own. */
export type StaffTarget = { external: false; href: string } | { external: true; href: string };

/**
 * The staff screens of the app that owns the page `pageId`, or null (no app,
 * or an app without them). Looked up by the page's id, because the dashboard
 * binding that asks — the only template with a page link — has the page
 * document, not its address.
 */
export function staffTargetFor(bootstrap: BootstrapData, pageId: string, path = ''): StaffTarget | null {
  const item = [...bootstrap.nav.groups.flatMap((group) => group.items), ...appPagesOf(bootstrap), ...hiddenPagesOf(bootstrap)].find(
    (candidate) => candidate.pageId === pageId,
  );
  const appKey = item?.appKey;
  if (appKey === undefined || appKey === null) return null;
  const staff = appSectionsOf(bootstrap).find((section) => section.appKey === appKey)?.staff ?? null;
  if (staff === null) return null;
  if (staff.placement === 'external') {
    if (staff.url === '') return null;
    if (path === '') return { external: true, href: staff.url };
    // One screen of a side on its own address: the path under the side's own (`staffLinkPath` kept it inside).
    try {
      const at = new URL(staff.url);
      at.pathname = `${at.pathname.replace(/\/?$/, '/')}${path}`;
      at.search = '';
      at.hash = '';
      return { external: true, href: at.toString() };
    } catch {
      return null;
    }
  }
  const base = `/a/${encodeURIComponent(appKey)}`;
  // One screen of the side, by its path (`@staff/approvals`).
  if (path !== '') return staff.items.length === 0 ? null : { external: false, href: `${base}/${path}` };
  // In the dashboard: the first screen, as the sidebar lists it first.
  const first = staff.items[0];
  if (first === undefined) return null;
  return { external: false, href: first.path === '' ? base : `${base}/${first.path}` };
}

/**
 * Open a target as the sidebar does: an app on its own address in a new tab
 * (the dashboard stays where it is), one inside the dashboard as a route.
 */
export function openStaffTarget(target: StaffTarget, push: (href: string) => void): void {
  if (target.external) {
    window.open(target.href, '_blank', 'noopener,noreferrer');
    return;
  }
  push(target.href);
}
