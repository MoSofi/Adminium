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
 * that serves a page's code (what a reader is given).
 */
import { ADD_ON_INSTALL_FLOOR, compareSemver } from '@adminium/manifest';

export function pagesAreGated(manifest: { compatibility: { minAdminiumVersion: string } }): boolean {
  return compareSemver(manifest.compatibility.minAdminiumVersion, ADD_ON_INSTALL_FLOOR) >= 0;
}

/** The permission that opens one page of an add-on's code. */
export const addOnPagePermission = (ref: string): string => `page:${ref}:view`;
