// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add-ons another has replaced, by key, with the one that replaced them.
 *
 * Each stays in the bundled set: a shop that has one attached (Maker Shop
 * 0.1 with the Personalizer, Print Shop 0.1 with Design Studio) must still be
 * able to update its app, and the update needs the retired add-on's last
 * release, whose range takes the new app line. What changes is that the
 * add-ons page no longer offers one for a fresh attach: it is listed only
 * where it is already installed, to be updated, detached and removed. The
 * marketplace has stopped listing them already.
 */
export const RETIRED_ADD_ONS: ReadonlyMap<string, string> = new Map([
  ['personalizer', 'customiser'],
  ['design-studio', 'customiser'],
]);

/** Whether the add-on is retired: kept for the shops that have it, offered to no one else. */
export const isRetiredAddOn = (key: string): boolean => RETIRED_ADD_ONS.has(key);
