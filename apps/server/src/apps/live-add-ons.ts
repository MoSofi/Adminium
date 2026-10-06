// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ADD-ONS THAT ARE HERE FOR AN APP.
 *
 * An add-on's public entries are served through the key of an app that names
 * it — and only while the add-on is live for that app: named by the app's
 * manifest (`addOns.requires` or `addOns.suggests`), installed, in the same
 * database, attached to the app and switched on for it. The moment one of
 * those stops being true, the entries leave the app's key.
 *
 * Read from the store each time it is asked: the answer decides what a key
 * may hold, so it is never a remembered one.
 */
import { isAddOnManifest, namedAddOns, validateManifest, type AddOnManifest, type Manifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';

export interface LiveAddOn {
  key: string;
  manifest: AddOnManifest;
  /** The add-on's short table names → the real ones, from its own records. */
  names: Readonly<Record<string, string>>;
}

/** Reading what is installed never opens a credential. */
const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading what is installed never writes a credential');
  },
  decrypt: (): string => {
    throw new Error('reading what is installed never reads a credential');
  },
};

/** The keys of the add-ons an app's manifest names. */
export function addOnsNamedBy(app: Manifest): string[] {
  if (app.kind !== 'app') return [];
  return [...new Set(namedAddOns(app.addOns).map((need) => need.key))];
}

/**
 * The add-ons live for `app` in this database, in the order the app names them.
 *
 * `moving` is an add-on whose own install, update or removal is asking: its
 * row is not `installed` while that runs, so the caller says what it is to be
 * read as — the manifest it is moving to with its tables' names, or null for
 * one that is going. It must still be named by the app, attached and switched on.
 */
export async function liveAddOnsFor(
  meta: MetaDb,
  app: Manifest,
  connectionId: string,
  moving?: { key: string; as: { manifest: AddOnManifest; names: Readonly<Record<string, string>> } | null },
): Promise<LiveAddOn[]> {
  const named = addOnsNamedBy(app);
  if (named.length === 0) return [];
  const manifests = manifestsRepo(meta, NO_SECRETS);
  const out: LiveAddOn[] = [];
  for (const key of named) {
    const found = await manifests.findByKey(key);
    if (found === null || found.row.kind !== 'add-on' || found.row.connectionId !== connectionId) continue;
    if (!found.attachments.some((attachment) => attachment.attachedTo === app.key && attachment.disabledAt === null)) continue;
    if (moving?.key === key) {
      if (moving.as !== null) out.push({ key, manifest: moving.as.manifest, names: moving.as.names });
      continue;
    }
    if (found.row.status !== 'installed') continue;
    const read = validateManifest(found.document);
    // A stored document that no longer reads serves nothing.
    if (!read.ok || !isAddOnManifest(read.manifest)) continue;
    out.push({ key, manifest: read.manifest, names: await appTablesRepo(meta).realNames(connectionId, key) });
  }
  return out;
}

/** The apps an installed add-on is attached to (switched on or off), by key. */
export async function appsAttachedTo(meta: MetaDb, addOnKey: string): Promise<string[]> {
  const found = await manifestsRepo(meta, NO_SECRETS).findByKey(addOnKey);
  if (found === null) return [];
  return found.attachments.map((attachment) => attachment.attachedTo);
}
