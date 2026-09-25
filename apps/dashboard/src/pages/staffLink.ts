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
 * An app with no staff screens resolves to nothing, and the page draws no
 * link at all rather than one that goes nowhere.
 */
import { appSectionsOf, findPageBySlug, type BootstrapData } from '../app/bootstrap.js';

export const STAFF_HREF = '@staff';

/** Where `@staff` goes for one page: a dashboard route, or an address of its own. */
export type StaffTarget = { external: false; href: string } | { external: true; href: string };

/** The staff screens of the app that owns `slug`, or null (no app, or an app without them). */
export function staffTargetFor(bootstrap: BootstrapData, slug: string): StaffTarget | null {
  const appKey = findPageBySlug(bootstrap, slug)?.appKey;
  if (appKey === undefined || appKey === null) return null;
  const staff = appSectionsOf(bootstrap).find((section) => section.appKey === appKey)?.staff ?? null;
  if (staff === null) return null;
  if (staff.placement === 'external') return staff.url === '' ? null : { external: true, href: staff.url };
  // In the dashboard: the first screen, as the sidebar lists it first.
  const first = staff.items[0];
  if (first === undefined) return null;
  const base = `/a/${encodeURIComponent(appKey)}`;
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
