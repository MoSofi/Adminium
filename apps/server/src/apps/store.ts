// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The installed-app package store.
 *
 * Packages live at `<dataDir>/apps/<key>/<version>/`, a sibling of `add-ons/`
 * and `files/`. This is deliberately NOT `ADMINIUM_SURFACES_DIR`: that
 * directory belongs to the operator, may be read-only, may not be set at all,
 * and is read exactly once at boot — so an install that wrote there would need
 * a restart to take effect and would silently fight whatever else put files in
 * it.
 *
 * There is no second implementation here, and that is the point. An uploaded
 * surface bundle is an archive from outside, served afterwards at the
 * dashboard's own origin, so it gets the same treatment an add-on package
 * gets: {@link createAddOnStore}'s key and version grammar, its containment
 * checks, `archive.ts`'s hardened USTAR allowlist, and the per-file sha256 pin
 * written OUTSIDE the tree so an archive cannot forge its own verification.
 * The only differences are the root and the noun in the refusal messages.
 *
 * WHY THE TWO STORES ARE SEPARATE ROOTS. App keys and add-on keys are separate
 * namespaces — `@adminium/manifest` lets the same key exist as both — so one
 * shared root would let an add-on named `clinic` overwrite the app named
 * `clinic`, or the reverse, with the store's own containment checks passing
 * the whole way.
 */

import { createAddOnStore, type AddOnStore } from '../add-ons/store.js';
import type { ArchiveLimits } from '../add-ons/archive.js';

/** Store root under `<dataDir>`, a sibling of `add-ons/` and `files/`. */
export const APPS_DIR = 'apps';

/**
 * The installed-app package store.
 *
 * Structurally identical to {@link AddOnStore} because it IS one — aliased
 * rather than re-declared so the two cannot drift, and named so callers read
 * as what they are.
 */
export type AppStore = AddOnStore;

export function createAppStore(opts: {
  dataDir: string;
  limits?: ArchiveLimits;
}): AppStore {
  return createAddOnStore({
    dataDir: opts.dataDir,
    ...(opts.limits === undefined ? {} : { limits: opts.limits }),
    subdir: APPS_DIR,
    label: 'app',
  });
}
