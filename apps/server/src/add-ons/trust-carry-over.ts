// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PACKAGES THAT RAN BEFORE EVERY PROVIDER NEEDED A VOUCHED PACKAGE KEEP
 * RUNNING.
 *
 * Up to 0.3.65 only a payment provider's and a card reader's code needed a
 * package Adminium vouches for (one this build bundles, one the catalogue
 * named, a kept copy of one of those). From 0.3.66 every contract's provider
 * and every event's server half does (`runtime.ts` `VOUCHED_CONTRACTS`). A
 * first-party package staged by a release before trust was recorded
 * (0.3.0–0.3.17), or uploaded by hand on a server with no catalogue, has no
 * trust record: without this, its document kinds, artwork sources,
 * personaliser or carrier would vanish at the update, with only a log line.
 *
 * So, ONCE, at the first boot of this release (`addOns.trustCarriedOver`):
 *  - each add-on installed when the server started (key and version, read
 *    before any request is served),
 *  - whose code loaded before this release (it provides no contract that
 *    already needed a vouched package, decides nothing inside a save, and
 *    serves no stranger's door: forms, chat, landing pages, each of which
 *    already needed one),
 *  - and that gains a refusal now (it provides a newly vouched contract, or
 *    has event code),
 *  - whose tree verifies on disk as it was unpacked,
 * is recorded as trusted by its tree's hash (`addOns.deciderTrust`), with its
 * kept copy beside it (`addOns.keptCopyTrust`), so a redeploy that puts it
 * back from that copy keeps it too.
 *
 * Never for a package staged after: the pass runs once, over what was
 * installed when the boot began. A package uploaded by hand from then on is
 * refused, as the vouching means it to be, and the Add-ons page says so.
 */
import { chatOf, formsOf, isAddOnManifest, landingOf, validateManifest, type AddOnManifest } from '@adminium/manifest';
import { settingsRepo, type ManifestsRepo, type MetaDb } from '@adminium/meta';

import { DECIDER_CONTRACTS, deciderTrusted } from './decide.js';
import { keptCopyTrust, recordDeciderTrust, trustSources } from './decider-trust.js';
import { VOUCHED_CONTRACTS } from './runtime.js';
import type { AddOnStore } from './store.js';

/** The contracts whose providers needed a vouched package before this release: their packages carried no new refusal. */
const VOUCHED_BEFORE: ReadonlySet<string> = new Set(['payment-provider', 'card-terminal']);

/**
 * Whether an installed add-on's code ran before this release and is refused
 * by it now, so it is one to carry over: see the header.
 */
export function carriedOverByRelease(manifest: AddOnManifest): boolean {
  const provides = manifest.addOn.provides ?? [];
  if (provides.some((entry) => DECIDER_CONTRACTS[entry.contract] !== undefined || VOUCHED_BEFORE.has(entry.contract))) return false;
  // A door's block at all, read or not: whatever the validator makes of it, a package that has one is never carried over.
  const block = manifest.addOn as { forms?: unknown; chat?: unknown; landing?: unknown };
  if (block.forms !== undefined || block.chat !== undefined || block.landing !== undefined) return false;
  if (formsOf(manifest) !== null || chatOf(manifest) !== null || landingOf(manifest) !== null) return false;
  return provides.some((entry) => VOUCHED_CONTRACTS.has(entry.contract)) || (manifest.addOn.events ?? []).some((event) => typeof event.server === 'string');
}

/**
 * The add-ons installed as the boot begins, by `<key>@<version>`, when the
 * carry-over has not run yet; null once it has. Read before the server
 * serves a request, so nothing uploaded during this boot is among them.
 */
export async function trustCarryOverCandidates(meta: MetaDb, manifests: Pick<ManifestsRepo, 'list'>): Promise<ReadonlySet<string> | null> {
  if (await settingsRepo(meta).get('addOns.trustCarriedOver')) return null;
  return new Set((await manifests.list('add-on')).map((entry) => `${entry.row.manifestKey}@${entry.row.version}`));
}

export interface CarryOverDeps {
  meta: MetaDb;
  manifests: Pick<ManifestsRepo, 'list'>;
  store: Pick<AddOnStore, 'verifyTree'>;
  log?: ((message: string, data: Record<string, unknown>) => void) | undefined;
}

/**
 * Records trust for the candidates that ran before this release (see the
 * header), then marks the carry-over done, whatever it found. Answers the
 * packages carried over, as `<key>@<version>`.
 */
export async function carryOverTrust(deps: CarryOverDeps, candidates: ReadonlySet<string>): Promise<string[]> {
  const carried: string[] = [];
  const copies = keptCopyTrust(deps.meta);
  const seen = new Set<string>();
  for (const entry of await deps.manifests.list('add-on')) {
    const id = `${entry.row.manifestKey}@${entry.row.version}`;
    // One tree per key and version, whatever the number of installs of it.
    if (!candidates.has(id) || seen.has(id)) continue;
    seen.add(id);
    const read = validateManifest(entry.document);
    if (!read.ok || !isAddOnManifest(read.manifest) || !carriedOverByRelease(read.manifest)) continue;
    let integrity: string;
    try {
      // A tree changed on disk after it was unpacked, or missing, is not carried over.
      integrity = (await deps.store.verifyTree(entry.row.manifestKey, entry.row.version)).integrity;
    } catch {
      continue;
    }
    const pkg = { key: entry.row.manifestKey, version: entry.row.version, integrity };
    // Trusted by its own bytes already (the bundle, the catalogue, a kept copy): nothing to carry over.
    if (deciderTrusted(pkg, await trustSources(deps.meta, {}))) continue;
    await recordDeciderTrust(deps.meta, pkg);
    // Its kept copy was packed from this very tree: put back from it after a redeploy, it is trusted as the tree is.
    if (entry.row.packageIntegrity !== null) await copies.record({ key: pkg.key, version: pkg.version, integrity: entry.row.packageIntegrity });
    carried.push(id);
  }
  await settingsRepo(deps.meta).set('addOns.trustCarriedOver', true, { updatedBy: null });
  if (carried.length > 0) deps.log?.('add-on packages installed before this release were carried over as trusted', { packages: carried });
  return carried;
}
