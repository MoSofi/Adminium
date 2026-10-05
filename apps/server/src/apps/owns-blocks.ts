// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a manifest is installed with its own tables, rules, pages, roles and
 * emails: an app, or an add-on that installs like one. The one question every
 * writer of those blocks asks before it writes anything; the add-ons released
 * before the install floor answer no, and are written nothing, as they always
 * were.
 *
 * The answer narrows to the app's manifest type on purpose. An add-on that
 * installs like an app declares these blocks in the app's own shape (the
 * schema builds both branches from one list), so a writer reads them the same
 * way on either. What an add-on does NOT have is `frontends`, and
 * `addOns.requires` / `addOns.features`: a writer that reads those must ask
 * for the kind first. `app-install-lift.test.ts` holds the writers to it.
 */
import { installsLikeAnApp, type AppManifest, type Manifest } from '@adminium/manifest';

export function ownsBlocks(manifest: Manifest): manifest is AppManifest {
  return manifest.kind === 'app' || installsLikeAnApp(manifest);
}
