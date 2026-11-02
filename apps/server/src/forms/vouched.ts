// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A PACKAGE THAT DECLARES FORMS MAY SERVE THEM.
 *
 * Forms are pages a stranger fills, and their answers become rows of the
 * owner's apps: a package that declares them must be one Adminium can vouch
 * for, by the very sources a package's deciding code needs (`add-ons/decide.ts`
 * `deciderTrusted`): the bytes this build bundles, the bytes the catalogue
 * named when it was downloaded, or a developer's key outside production. A
 * package uploaded by hand is none of these: it installs, and every form of
 * it answers "not available".
 *
 * A tree that no longer verifies on disk (changed after it was installed) is
 * not vouched for either.
 */
import { formsOf, type AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import { trustSources } from '../add-ons/decider-trust.js';
import { deciderTrusted } from '../add-ons/decide.js';
import type { AddOnStore } from '../add-ons/store.js';

/** Whether a package that declares forms serves them here. */
export async function formsPackageVouched(store: Pick<AddOnStore, 'verifyTree'>, meta: MetaDb, pkg: { key: string; version: string }): Promise<boolean> {
  let integrity: string;
  try {
    integrity = (await store.verifyTree(pkg.key, pkg.version)).integrity;
  } catch {
    return false;
  }
  return deciderTrusted({ key: pkg.key, version: pkg.version, integrity }, await trustSources(meta));
}

/** Whether a manifest declares forms, so its package must be vouched for to serve them. */
export const declaresForms = (manifest: AddOnManifest): boolean => formsOf(manifest) !== null;
