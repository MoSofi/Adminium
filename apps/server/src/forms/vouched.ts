// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A PACKAGE THAT DECLARES A STRANGER'S DOOR MAY SERVE IT.
 *
 * Forms are pages a stranger fills, a live chat is a conversation a
 * stranger holds, and a landing page is owner content drawn on the install's
 * own address; what a stranger sends becomes rows of the owner's apps. A
 * package that declares one must be one Adminium can vouch for, by the very
 * sources a package's deciding code needs (`add-ons/decide.ts`
 * `deciderTrusted`): the bytes this build bundles, the bytes the catalogue
 * named when it was downloaded, or a developer's key outside production. A
 * package uploaded by hand is none of these: it installs, and every form,
 * chat or landing page of it answers "not available".
 *
 * A tree that no longer verifies on disk (changed after it was installed) is
 * not vouched for either. A tree missing altogether (a redeploy emptied the
 * disk) is judged by the install's kept copy (`vouchedWithoutFiles`).
 */
import { chatOf, formsOf, landingOf, type AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import { trustSources, vouchedWithoutFiles } from '../add-ons/decider-trust.js';
import { deciderTrusted } from '../add-ons/decide.js';
import type { AddOnStore } from '../add-ons/store.js';

/** Whether a package that declares a stranger's door (forms, chat, landing pages) serves it here. */
export async function doorPackageVouched(store: Pick<AddOnStore, 'verifyTree' | 'versions'>, meta: MetaDb, pkg: { key: string; version: string }): Promise<boolean> {
  let integrity: string;
  try {
    integrity = (await store.verifyTree(pkg.key, pkg.version)).integrity;
  } catch (failure) {
    return vouchedWithoutFiles(store, meta, pkg, failure);
  }
  return deciderTrusted({ key: pkg.key, version: pkg.version, integrity }, await trustSources(meta));
}

/** Whether a package that declares forms serves them here: the same judgement, under its first name. */
export const formsPackageVouched = doorPackageVouched;

/** Whether a manifest declares forms, so its package must be vouched for to serve them. */
export const declaresForms = (manifest: AddOnManifest): boolean => formsOf(manifest) !== null;

/** Whether a manifest declares chat, so its package must be vouched for to serve it. */
export const declaresChat = (manifest: AddOnManifest): boolean => chatOf(manifest) !== null;

/** Whether a manifest declares landing pages, so its package must be vouched for to serve them. */
export const declaresLanding = (manifest: AddOnManifest): boolean => landingOf(manifest) !== null;
