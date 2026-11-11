// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which folders a `local` storage destination may write into.
 *
 * A `local` destination names a folder on this server, and every upload is
 * written under it. Typed by whoever holds `storage.manage` (or set by
 * `ADMINIUM_STORAGE_URL=file:///…`), it used to be any folder at all: the data
 * dir's own `backups/`, the folder holding the meta store, `/`. So the same
 * two rules as a SQLite source (`connections/sqlite-guard.ts`), read from the
 * folder's REAL path (symlinks followed), so a link that points into one of
 * those folders is refused too:
 *
 *  1. Never Adminium's own files and folders: the meta store file and its
 *     companions, the data dir's own folders (`backups/`, `files/`, `tmp/`,
 *     `add-ons/`, `pre-restore-…`), and no folder that CONTAINS the data dir
 *     or the meta store (`/`, the data dir itself, its parent).
 *  2. When the operator sets `ADMINIUM_STORAGE_DIRS`, only folders under one
 *     of those. Unset: any other folder, as before.
 */
import type { Env } from '../config/env.js';
import { ownPathRefusal, pathWithin, realPath, type OwnFiles, type OwnPathReason } from '../connections/sqlite-guard.js';
import { ValidationFailedError } from '../errors.js';
import { sqlitePathFromUrl, type MetaStoreHandle } from '../meta/store.js';

/** What a `local` root is checked against: Adminium's own files, and `ADMINIUM_STORAGE_DIRS`. */
export interface StorageRootPolicy {
  own: OwnFiles;
  /** `ADMINIUM_STORAGE_DIRS`: when set, a root must lie under one of these folders. */
  dirs?: readonly string[] | undefined;
}

/** The policy on this server: the data dir and the meta store's own file, and `ADMINIUM_STORAGE_DIRS`. */
export function storageRootPolicyFor(
  env: Pick<Env, 'ADMINIUM_DATA_DIR' | 'ADMINIUM_STORAGE_DIRS'>,
  metaStore: Pick<MetaStoreHandle, 'engine' | 'url'>,
): StorageRootPolicy {
  return {
    own: { dataDir: env.ADMINIUM_DATA_DIR, metaFile: metaStore.engine === 'sqlite' ? sqlitePathFromUrl(metaStore.url) : null },
    dirs: env.ADMINIUM_STORAGE_DIRS,
  };
}

export interface StorageRootRefusal {
  message: string;
  details: Record<string, unknown>;
}

const MESSAGES: Record<OwnPathReason, (name: string | undefined) => string> = {
  'meta-store': () => "This is Adminium's own meta store file, not a folder for files. Choose a folder of its own.",
  'meta-companion': () => "This belongs to Adminium's own meta store, not a folder for files. Choose a folder of its own.",
  'data-folder': (name) =>
    `This folder is one of Adminium's own (${name ?? 'data directory'} in its data directory). Choose a folder of its own for files.`,
  'contains-data': () => "This folder holds Adminium's own data directory. Choose a folder of its own.",
};

/** Why `root` may not be a `local` destination's folder under `policy`, or null when it may. */
export function storageRootRefusal(root: string, policy: StorageRootPolicy): StorageRootRefusal | null {
  const own = ownPathRefusal(root, policy.own, { folder: true });
  if (own !== null) {
    return {
      message: MESSAGES[own.reason](own.name),
      details: { config: 'root', root, reason: own.reason, ...(own.name === undefined ? {} : { folder: own.name }) },
    };
  }
  const dirs = policy.dirs ?? [];
  if (dirs.length > 0) {
    const real = realPath(root);
    if (!dirs.some((dir) => pathWithin(real, realPath(dir)))) {
      return {
        message: `This folder is outside the folders this server allows for files (ADMINIUM_STORAGE_DIRS: ${dirs.join(', ')}). Choose a folder inside one of them, or ask whoever runs this server to add it to ADMINIUM_STORAGE_DIRS.`,
        details: { config: 'root', root, reason: 'outside-storage-dirs', variable: 'ADMINIUM_STORAGE_DIRS', dirs: [...dirs] },
      };
    }
  }
  return null;
}

/** {@link storageRootRefusal} as a guard: throws 422 `VALIDATION_FAILED` before anything is written there. */
export function assertStorageRootAllowed(root: string, policy: StorageRootPolicy): void {
  const refusal = storageRootRefusal(root, policy);
  if (refusal !== null) throw new ValidationFailedError(refusal.message, refusal.details);
}
