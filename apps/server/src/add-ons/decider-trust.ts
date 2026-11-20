// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whose deciding code this server may run, as it is kept: the packages the
 * build bundles (`bundled-pins.ts`), the ones recorded when the bundled seed
 * staged them or a catalogue download verified them (the meta setting
 * `addOns.deciderTrust`), the copies kept of those (`addOns.keptCopyTrust`),
 * and a developer's list from the environment.
 * A package uploaded by hand is recorded nowhere, so its deciding code does
 * not load. The judgement itself is `deciderTrusted` (`decide.ts`).
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { BUNDLED_PINS } from './bundled-pins.js';
import { runTrustedKeys } from './dev-trust.js';
import { deciderTrusted, type TrustSources, type TrustedPackage } from './decide.js';
import { AddOnStoreError, type AddOnStore } from './store.js';

/** Records that a package's bytes were vouched for: by the build's own bundle, or by the catalogue's feed. */
export async function recordDeciderTrust(meta: MetaDb, pkg: TrustedPackage): Promise<void> {
  const settings = settingsRepo(meta);
  const recorded = await settings.get('addOns.deciderTrust');
  const id = `${pkg.key}@${pkg.version}`;
  if (recorded[id] === pkg.integrity) return;
  await settings.set('addOns.deciderTrust', { ...recorded, [id]: pkg.integrity });
}

/**
 * Everything the judgement reads, as it stands now. A try run's own keys are
 * read with this process's environment only: a judgement of the bytes (an
 * empty `env`) never counts them, as it never counts the developer's list.
 */
export async function trustSources(meta: MetaDb, env: Readonly<Record<string, string | undefined>> = process.env): Promise<TrustSources> {
  return {
    bundled: BUNDLED_PINS,
    recorded: await settingsRepo(meta).get('addOns.deciderTrust'),
    devKeys: env['ADMINIUM_ADD_ON_DEV_TRUST'],
    nodeEnv: env['NODE_ENV'],
    ...(env === process.env ? { runKeys: runTrustedKeys() } : {}),
    kept: await settingsRepo(meta).get('addOns.keptCopyTrust'),
  };
}

// ── kept copies ───────────────────────────────────────────────────────────────

/**
 * What keeping a copy of a package (`package-copies.ts`) asks of trust.
 *
 * A copy is a repack of the staged tree, so its hash is neither the bundle's
 * pin nor the catalogue's. When the tree it was packed from was trusted by its
 * own bytes, the copy's hash is recorded beside it (`addOns.keptCopyTrust`),
 * and the package put back from that copy is trusted as its original was. A
 * tree trusted only by the developer's list is not trusted by its bytes, so
 * its copy is not recorded: the list is ignored in production, and a copy
 * must not carry its trust there.
 */
export interface KeptCopyTrust {
  /** The copy hash recorded as trusted for `<key>@<version>`, if any. */
  kept(key: string, version: string): Promise<string | undefined>;
  /** Whether a staged tree is trusted by its own bytes: the bundle, the catalogue's record, or a kept copy. */
  original(pkg: TrustedPackage): Promise<boolean>;
  /** Records the hash of a copy packed from a trusted tree. */
  record(copy: TrustedPackage): Promise<void>;
}

export function keptCopyTrust(meta: MetaDb): KeptCopyTrust {
  const settings = settingsRepo(meta);
  return {
    async kept(key, version) {
      return (await settings.get('addOns.keptCopyTrust'))[`${key}@${version}`];
    },
    async original(pkg) {
      // No environment: the developer's list is not a judgement of the bytes.
      return deciderTrusted(pkg, await trustSources(meta, {}));
    },
    async record(copy) {
      const recorded = await settings.get('addOns.keptCopyTrust');
      const id = `${copy.key}@${copy.version}`;
      if (recorded[id] === copy.integrity) return;
      await settings.set('addOns.keptCopyTrust', { ...recorded, [id]: copy.integrity });
    },
  };
}

/**
 * A door package whose files are missing altogether, judged by what the meta
 * store keeps of it.
 *
 * A door (forms, chat) reads the meta store and the add-on's tables, never the
 * package's code, so its files are not what it serves. But the store holds no
 * record of which bytes were installed except the kept copy: an install's row
 * names the copy's hash, and that hash is recorded as trusted only when the
 * tree it was packed from was. So the door is vouched for exactly when the
 * install's kept copy is a trusted one, which is the case the restore at boot
 * would put back as trusted: a destination that cannot be reached at boot, or
 * a request that arrives before the restore has finished.
 *
 * "Missing altogether" is no tree pin AND no version directory. A directory
 * without its pin, or a pin with files missing from its tree, is drift, and
 * stays refused. With no copy held (no storage destination), nothing records
 * what was installed, so the door is not vouched for.
 */
export async function vouchedWithoutFiles(store: Pick<AddOnStore, 'versions'>, meta: MetaDb, pkg: { key: string; version: string }, failure: unknown): Promise<boolean> {
  if (!(failure instanceof AddOnStoreError) || failure.reason !== 'TREE_MISSING') return false;
  if ((await store.versions(pkg.key)).includes(pkg.version)) return false;
  const kept = await settingsRepo(meta).get('addOns.keptCopyTrust');
  const trusted = kept[`${pkg.key}@${pkg.version}`];
  if (trusted === undefined) return false;
  // One tree of a key@version serves every install of it, and each install's copy is packed from
  // that one tree, so every install's copy must be the trusted one: an install with no copy, or
  // another copy, names a tree this server cannot vouch for. A key-wide read, on purpose.
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select('packageIntegrity')
    .where('kind', '=', 'add-on')
    .where('manifestKey', '=', pkg.key)
    .where('version', '=', pkg.version)
    .execute();
  return rows.length > 0 && rows.every((row) => row.packageIntegrity === trusted);
}
