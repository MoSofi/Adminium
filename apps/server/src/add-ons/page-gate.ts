// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH ADD-ONS KEEP THEIR PAGES BEHIND A PERMISSION.
 *
 * An add-on built for a server that installs it like an app (its floor says
 * so) is seen through its own roles: each page of its code is opened only by
 * somebody who holds `page:<ref>:view`, and the page's ref starts with the
 * add-on's key, so no two add-ons share one. An add-on from before — every
 * one released until now — keeps its page open to anybody signed in, exactly
 * as it was.
 *
 * One question, asked by the rail (what a reader is told of) and by the route
 * that serves a page's code (what a reader is given); and, beside it, where
 * an add-on's pages are at all (`pagesOnDashboard`).
 */
import { ADD_ON_INSTALL_FLOOR, compareSemver } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

export function pagesAreGated(manifest: { compatibility: { minAdminiumVersion: string } }): boolean {
  return compareSemver(manifest.compatibility.minAdminiumVersion, ADD_ON_INSTALL_FLOOR) >= 0;
}

/** The permission that opens one page of an add-on's code. */
export const addOnPagePermission = (ref: string): string => `page:${ref}:view`;

/** The host an add-on's pages are mounted on when it names the dashboard. */
const DASHBOARD = 'dashboard';

/** One of an add-on's attachments, as far as where its pages are is concerned. */
export interface PageHostAttachment {
  attachedTo: string;
  disabledAt: unknown;
}

/**
 * WHETHER AN ADD-ON'S PAGES ARE ON THE DASHBOARD.
 *
 * An add-on that names the dashboard among its hosts is mounted there at
 * install, and that attachment decides: switched off for the dashboard, its
 * pages are not there for anybody. An add-on made for certain apps only (a
 * design kit that names the two shops it serves) has no such attachment, and
 * its pages would be declared, listed nowhere and unreachable; it has them
 * while one of those apps is installed and switched on, with the add-on
 * connected and switched on there. Who may open each page is asked apart,
 * by its own permission.
 */
export function pagesOnDashboard(attachments: readonly PageHostAttachment[], appsOn: ReadonlySet<string>): boolean {
  const dashboard = attachments.find((attachment) => attachment.attachedTo === DASHBOARD);
  if (dashboard !== undefined) return dashboard.disabledAt === null;
  return attachments.some((attachment) => attachment.disabledAt === null && appsOn.has(attachment.attachedTo));
}

/** The apps installed and switched on: the hosts whose add-ons' pages are on the dashboard. */
export async function appsSwitchedOn(meta: MetaDb): Promise<Set<string>> {
  const rows = await meta.db.selectFrom('adminium_manifests').select('manifestKey').where('kind', '=', 'app').where('status', '=', 'installed').execute();
  return new Set(rows.map((row) => row.manifestKey));
}
