// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on package store (32-add-on-distribution.md §4.1, D11).
 *
 * Packages live at `<dataDir>/add-ons/<key>/<version>/`, a sibling of `files/`,
 * cloning `files/storage.ts`'s fail-closed discipline: a key is accepted only
 * when it matches the manifest key grammar, a version only when it matches
 * strict semver, and the resolved path must still live under the store root.
 * All three checks throw; nothing outside `<dataDir>/add-ons/` is ever read,
 * written, or deleted, whatever a catalog entry or a database row claims.
 *
 * WHY NOT `adminium_files`. That table addresses bytes by `file_<ULID>`, which
 * has nowhere to put a version, and `FileKind` has no member that fits a code
 * package. A package is also a TREE, not a blob — the runtime serves individual
 * files out of it by relative path.
 *
 * THE THREE SOURCES ARE ONE PATH. Bundled (D3), npm (D2) and sideload (D4) all
 * arrive here as a tarball plus an expected sha512, and all three go through
 * {@link AddOnStore.stage}. There is deliberately no second, softer entry point.
 *
 * THE TOCTOU WINDOW, AND WHY THE HASH MANIFEST EXISTS. The data volume is
 * shared, writable state: between the moment a package is unpacked and the
 * moment 26's installer parses `manifest.json`, anything with write access to
 * the volume could edit the tree. So {@link AddOnStore.stage} records a
 * per-file sha256 manifest at unpack time, and {@link AddOnStore.verifyTree}
 * re-checks the tree against it before install parses a single byte. Install
 * never re-trusts bare disk bytes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import {
  DEFAULT_ARCHIVE_LIMITS,
  readAddOnTarball,
  type ArchiveLimits,
} from './archive.js';

export const ADD_ONS_DIR = 'add-ons';

/**
 * Suffix of the per-file hash pin, written as a SIBLING of the package
 * directory: `<root>/<key>/<version>.pin.json` guards `<root>/<key>/<version>/`.
 *
 * IT USED TO LIVE INSIDE THE TREE, AND THAT WAS A HOLE. A pin stored among the
 * files it protects is written by the same unpack that writes those files, so
 * an archive carrying its own `.adminium-tree.json` had its forgery recorded as
 * the pin — and `verifyTree` would then confirm the tree against the attacker's
 * own document. Worse, the pin was excluded from the walk that detects added
 * files, so the one path guaranteed not to be checked was the one that decided
 * what checking meant. Outside the directory, an archive cannot name it: every
 * entry path is forced under `<version>/` by the unpack, so nothing an archive
 * contains can reach a sibling.
 */
export const TREE_PIN_SUFFIX = '.pin.json';

/** Prefix marking a temp directory mid-unpack; pruned at boot. */
const TEMP_PREFIX = '.staging-';

/** Prefix marking a superseded tree kept only until its replacement lands. */
const BACKUP_PREFIX = '.replaced-';

/** Where `catalog-refresh` parks the last feed it fetched. */
const CATALOG_CACHE_FILE = '.catalog-cache.json';

/**
 * The manifest key grammar, mirroring `@adminium/manifest`'s `identityShape`
 * (`^[a-z][a-z0-9-]{1,79}$`). Restated rather than imported because it guards a
 * PATH here, and a path guard should not be able to change out from under this
 * module because a schema was relaxed for an unrelated reason. `store.test.ts`
 * asserts the two agree.
 */
const KEY_RE = /^[a-z][a-z0-9-]{1,79}$/;

/**
 * Strict semver, mirroring the same package's `SEMVER`. Every character the
 * grammar admits (`0-9A-Za-z-.+`) is filesystem-safe, and a leading `.` is
 * impossible, so a version can never name a dotfile or a temp directory.
 */
const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Every refusal the store itself can produce. */
export type StoreRefusal =
  | 'UNSAFE_KEY'
  | 'UNSAFE_VERSION'
  | 'PATH_ESCAPES_ROOT'
  | 'INTEGRITY_MISMATCH'
  | 'TREE_MODIFIED'
  | 'TREE_MISSING'
  | 'MANIFEST_MISSING';

export class AddOnStoreError extends Error {
  override readonly name = 'AddOnStoreError';
  readonly reason: StoreRefusal;

  constructor(reason: StoreRefusal, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** The per-file pin recorded at unpack and re-checked before install. */
export interface TreeManifest {
  key: string;
  version: string;
  /** sha512 of the tarball these files came out of, as `sha512-<base64>`. */
  integrity: string;
  /** Relative path -> sha256 hex, sorted by path so the file is stable. */
  files: Record<string, string>;
}

export interface StagedPackage {
  key: string;
  version: string;
  /** Absolute path of the staged package directory. */
  dir: string;
  tree: TreeManifest;
}

export interface AddOnStore {
  /** Absolute store root (`<dataDir>/add-ons`). */
  readonly root: string;
  /** Absolute directory for one package version (no I/O; validates only). */
  dirFor(key: string, version: string): string;
  /**
   * Verify + hardened-unpack a tarball into `<key>/<version>/`, atomically.
   * Replaces any package already staged under that key (D11: at most one
   * staged version per key at a time).
   */
  stage(input: StageInput): Promise<StagedPackage>;
  /** Re-check a staged tree against its recorded pin. Throws on any drift. */
  verifyTree(key: string, version: string): Promise<TreeManifest>;
  /** Read one file out of a package by relative path (containment-checked). */
  readFile(key: string, version: string, relativePath: string): Promise<Buffer>;
  /**
   * Read one file AND check it against the pin recorded at unpack — 26 §5.4's
   * "checked on read", scoped to the one file being served.
   *
   * Separate from {@link AddOnStore.verifyTree} on purpose: serving a bundle
   * re-hashes ONE file, where verifying the whole tree on every asset request
   * would re-hash the entire package. Install uses the tree check; the serve
   * path uses this. Returns the bytes and the recorded sha256, which is also
   * what the SRI value is derived from — one hash, recorded once, used for both.
   */
  readVerifiedFile(
    key: string,
    version: string,
    relativePath: string,
  ): Promise<{ bytes: Buffer; sha256: string }>;
  /**
   * The sha256 the pin RECORDED for one file, without reading the file.
   *
   * For the LIST, which needs each bundle's integrity value and none of its
   * bytes. `readVerifiedFile` was doing that job and paying for it twice over:
   * a full read plus a fresh digest per bundle per add-on, on a route the
   * host calls on every page load, and then discarding the bytes to return the
   * hash the pin already held.
   *
   * It is not a weaker guarantee in the place that matters. "Checked on read"
   * is about the bytes a browser EXECUTES, and that check still happens where
   * they are served — `readVerifiedFile`, on the bundle route. Advertising a
   * hash is not serving one.
   */
  pinnedSha256(key: string, version: string, relativePath: string): Promise<string>;
  /** Versions present for a key, newest-first by directory name order. */
  versions(key: string): Promise<string[]>;
  /** Every key that has at least one version on disk. */
  keys(): Promise<string[]>;
  /** Remove one version (staged-discard, and upgrade pruning). */
  removeVersion(key: string, version: string): Promise<void>;
  /** Remove the whole package directory (26's uninstall hook, D11). */
  removeKey(key: string): Promise<void>;
  /** Delete orphaned temp directories left by an interrupted unpack. */
  pruneTemp(): Promise<number>;
  /**
   * The last catalog document `catalog-refresh` fetched, or `null` when the
   * deployment has never browsed online (the air-gapped steady state).
   *
   * It lives beside the packages rather than in a settings row because it is a
   * document of unbounded-ish size that nothing queries by value, and because
   * this module is already the one place that owns `<dataDir>/add-ons` path
   * handling. The leading dot keeps it out of {@link AddOnStore.keys}, whose
   * grammar cannot match it.
   */
  readCatalogCache(): Promise<{ fetchedAt: number; document: unknown } | null>;
  writeCatalogCache(document: unknown, at: number): Promise<void>;
}

export interface StageInput {
  key: string;
  version: string;
  tarball: Uint8Array;
  /**
   * `sha512-<base64>` — npm's packument `dist.integrity` format, which is also
   * what the release ledger records and what the sideload route asks the
   * operator for. Compared in constant time.
   */
  expectedIntegrity: string;
  limits?: ArchiveLimits;
}

/** npm's Subresource-Integrity spelling of a tarball hash. */
export function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/**
 * Constant-time compare of two integrity strings. Length is compared first and
 * non-secretly — the strings are fixed-format, so length alone leaks nothing.
 */
function integrityMatches(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Newest-first order over the release triple.
 *
 * A plain `.sort().reverse()` is LEXICOGRAPHIC, which puts `1.9.0` above
 * `1.10.0` and `0.2.2` above `0.10.0` — so "the newest version on disk" would
 * have been wrong for every package that reached a double-digit minor or patch.
 * Pre-release and build metadata are ignored for ordering (the same
 * simplification `@adminium/manifest`'s `compareSemver` makes) but a
 * pre-release still sorts below its release, which is the one case where
 * ignoring it outright would be visibly wrong.
 */
function compareVersionsDesc(a: string, b: string): number {
  const triple = (v: string): number[] =>
    v.split(/[-+]/)[0]!.split('.').map((part) => Number.parseInt(part, 10));
  const left = triple(a);
  const right = triple(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const aPre = a.includes('-');
  const bPre = b.includes('-');
  if (aPre !== bPre) return aPre ? 1 : -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

export function createAddOnStore(opts: {
  dataDir: string;
  limits?: ArchiveLimits;
}): AddOnStore {
  const root = resolve(opts.dataDir, ADD_ONS_DIR);
  const defaultLimits = opts.limits ?? DEFAULT_ARCHIVE_LIMITS;

  /** Grammar check + containment check for a package directory. */
  function dirFor(key: string, version: string): string {
    if (!KEY_RE.test(key)) {
      throw new AddOnStoreError('UNSAFE_KEY', `unsafe add-on key: ${JSON.stringify(key)}`);
    }
    if (!VERSION_RE.test(version)) {
      throw new AddOnStoreError('UNSAFE_VERSION', `unsafe version: ${JSON.stringify(version)}`);
    }
    const target = resolve(join(root, key, version));
    if (target !== join(root, key, version) || !target.startsWith(root + sep)) {
      throw new AddOnStoreError(
        'PATH_ESCAPES_ROOT',
        `add-on path escapes the store root: ${JSON.stringify(`${key}/${version}`)}`,
      );
    }
    return target;
  }

  /**
   * Containment re-check for one file inside a package directory. The archive
   * reader already refused traversal, but this is the check that actually
   * governs the write — belt and braces on the RCE path, and the reason a
   * future change to the reader cannot silently become a write primitive.
   */
  function fileIn(packageDir: string, relativePath: string): string {
    const target = resolve(join(packageDir, relativePath));
    if (target !== join(packageDir, relativePath) || !target.startsWith(packageDir + sep)) {
      throw new AddOnStoreError(
        'PATH_ESCAPES_ROOT',
        `package file escapes its directory: ${JSON.stringify(relativePath)}`,
      );
    }
    return target;
  }

  /**
   * The pin's path: a SIBLING of the package directory, never inside it.
   * Validated through `dirFor` first so key and version are already known-safe.
   */
  function pinFor(key: string, version: string): string {
    return `${dirFor(key, version)}${TREE_PIN_SUFFIX}`;
  }

  async function readTreeManifest(key: string, version: string): Promise<TreeManifest> {
    let raw: string;
    try {
      raw = await readFile(pinFor(key, version), 'utf8');
    } catch {
      throw new AddOnStoreError('TREE_MISSING', `no recorded tree pin for ${key}@${version}`);
    }
    let parsed: TreeManifest;
    try {
      parsed = JSON.parse(raw) as TreeManifest;
    } catch {
      throw new AddOnStoreError('TREE_MODIFIED', `the tree pin for ${key}@${version} is unreadable`);
    }
    // The pin names what it guards. A pin moved or copied between packages is
    // not a pin, and reading one that disagrees is a refusal rather than a
    // best-effort check against the wrong document.
    if (parsed.key !== key || parsed.version !== version) {
      throw new AddOnStoreError(
        'TREE_MODIFIED',
        `the pin at ${key}@${version} claims to describe ${parsed.key}@${parsed.version}`,
      );
    }
    return parsed;
  }

  return {
    root,
    dirFor,

    async stage(input) {
      const target = dirFor(input.key, input.version);

      // 1. Integrity FIRST: the cheapest gate, and the one that decides whether
      //    these bytes are the ones the packument/ledger named. Everything
      //    downstream is still treated as hostile regardless (D5) — a matching
      //    hash proves origin, not safety.
      const actual = sha512Integrity(input.tarball);
      if (!integrityMatches(actual, input.expectedIntegrity)) {
        throw new AddOnStoreError(
          'INTEGRITY_MISMATCH',
          `tarball hash ${actual} does not match the expected ${input.expectedIntegrity}`,
        );
      }

      // 2. Hardened unpack, in memory. Nothing has touched the disk yet.
      const entries = readAddOnTarball(input.tarball, input.limits ?? defaultLimits);

      // 3. Write into a temp directory INSIDE the store root, so the rename
      //    below is a same-filesystem operation (a cross-device rename falls
      //    back to a copy and stops being atomic).
      //
      //    The temp name carries the key, the version AND a random suffix.
      //    Version, because two versions of one key staging concurrently would
      //    otherwise share a directory and the first `rm` would delete the
      //    other's half-written tree; random, because the same (key, version)
      //    from two workers would still collide, and the hash prefix it used to
      //    use is IDENTICAL for identical bytes — precisely the case that
      //    collides most.
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temp = join(
        root,
        `${TEMP_PREFIX}${input.key}-${input.version}-${randomBytes(8).toString('hex')}`,
      );
      await mkdir(temp, { recursive: true, mode: 0o700 });

      const pin = pinFor(input.key, input.version);
      const backup = join(root, `${BACKUP_PREFIX}${input.key}-${input.version}-${randomBytes(8).toString('hex')}`);
      let replaced = false;

      try {
        const files: Record<string, string> = {};
        for (const entry of entries) {
          const file = fileIn(temp, entry.path);
          await mkdir(dirname(file), { recursive: true, mode: 0o700 });
          // 0o600 regardless of the archive's mode bits (D5).
          await writeFile(file, entry.bytes, { mode: 0o600 });
          files[entry.path] = sha256(entry.bytes);
        }

        if (files['manifest.json'] === undefined) {
          throw new AddOnStoreError(
            'MANIFEST_MISSING',
            'package carries no manifest.json at its root',
          );
        }

        const tree: TreeManifest = {
          key: input.key,
          version: input.version,
          integrity: actual,
          // Sorted so the pin file is byte-stable for the same input.
          files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
        };

        // 4. Swap, keeping the outgoing tree until the new one is in place.
        //    A bare `rm(target)` then `rename(temp, target)` is two operations,
        //    and a failure between them leaves a working install DELETED with
        //    nothing to roll back to. Renaming the old tree aside first makes
        //    the destructive step reversible.
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        if (await stat(target).catch(() => undefined)) {
          await rename(target, backup);
          replaced = true;
        }
        try {
          await rename(temp, target);
        } catch (err) {
          if (replaced) await rename(backup, target).catch(() => undefined);
          throw err;
        }

        // 5. The pin last, and OUTSIDE the tree it describes (see
        //    TREE_PIN_SUFFIX). Written temp-then-rename so a crash cannot leave
        //    a half-document that `verifyTree` would read as the pin.
        const pinTemp = `${pin}.partial`;
        await writeFile(pinTemp, `${JSON.stringify(tree, null, 2)}\n`, { mode: 0o600 });
        await rename(pinTemp, pin);

        if (replaced) await rm(backup, { recursive: true, force: true });
        return { key: input.key, version: input.version, dir: target, tree };
      } catch (err) {
        // Any refusal leaves nothing behind (D5) — including the outgoing tree,
        // which is put back rather than lost.
        await rm(temp, { recursive: true, force: true });
        if (replaced) {
          await rm(target, { recursive: true, force: true }).catch(() => undefined);
          await rename(backup, target).catch(() => undefined);
        }
        await rm(backup, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    },

    async verifyTree(key, version) {
      const dir = dirFor(key, version);
      const tree = await readTreeManifest(key, version);

      for (const [path, want] of Object.entries(tree.files)) {
        let bytes: Buffer;
        try {
          bytes = await readFile(fileIn(dir, path));
        } catch {
          throw new AddOnStoreError('TREE_MODIFIED', `staged file is missing: ${path}`);
        }
        if (sha256(bytes) !== want) {
          throw new AddOnStoreError('TREE_MODIFIED', `staged file was modified: ${path}`);
        }
      }

      // An ADDED file is drift too: the pin is the whole tree, not a subset.
      // Without this a writer with volume access could drop an extra module
      // beside the pinned ones and have the runtime load it.
      //
      // NOTHING IS SKIPPED IN THIS WALK. It used to skip the pin, because the
      // pin lived in here; a skipped path is a path an attacker can use, so the
      // pin moved out (see TREE_PIN_SUFFIX) and the walk now has no exceptions
      // at all. A symlink is reported as drift rather than followed: `readdir`
      // does not follow, `isDirectory()` is false for one, so it lands in
      // `found` and fails the unpinned check — which is what should happen,
      // since unpack never writes one.
      const found = new Set<string>();
      const walk = async (relative: string): Promise<void> => {
        const here = relative === '' ? dir : fileIn(dir, relative);
        for (const item of await readdir(here, { withFileTypes: true })) {
          const child = relative === '' ? item.name : `${relative}/${item.name}`;
          if (item.isDirectory()) await walk(child);
          else found.add(child);
        }
      };
      await walk('');
      for (const path of found) {
        if (tree.files[path] === undefined) {
          throw new AddOnStoreError('TREE_MODIFIED', `unpinned file appeared in the tree: ${path}`);
        }
      }

      return tree;
    },

    async readFile(key, version, relativePath) {
      const dir = dirFor(key, version);
      return readFile(fileIn(dir, relativePath));
    },

    async pinnedSha256(key, version, relativePath) {
      const tree = await readTreeManifest(key, version);
      const want = tree.files[relativePath];
      if (want === undefined) {
        throw new AddOnStoreError(
          'TREE_MODIFIED',
          `${relativePath} is not one of the files pinned for ${key}@${version}`,
        );
      }
      return want;
    },

    async readVerifiedFile(key, version, relativePath) {
      const dir = dirFor(key, version);
      const tree = await readTreeManifest(key, version);
      const want = tree.files[relativePath];
      if (want === undefined) {
        // Not "missing file" — the file may well be on disk. It is not one of
        // the files this package was VERIFIED to contain, which is a different
        // and more interesting fact: something put it there after unpack.
        throw new AddOnStoreError(
          'TREE_MODIFIED',
          `${relativePath} is not one of the files pinned for ${key}@${version}`,
        );
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(fileIn(dir, relativePath));
      } catch {
        throw new AddOnStoreError('TREE_MODIFIED', `pinned file is missing: ${relativePath}`);
      }
      if (sha256(bytes) !== want) {
        throw new AddOnStoreError('TREE_MODIFIED', `pinned file was modified: ${relativePath}`);
      }
      return { bytes, sha256: want };
    },

    async versions(key) {
      if (!KEY_RE.test(key)) {
        throw new AddOnStoreError('UNSAFE_KEY', `unsafe add-on key: ${JSON.stringify(key)}`);
      }
      try {
        const items = await readdir(join(root, key), { withFileTypes: true });
        return items
          .filter((item) => item.isDirectory() && VERSION_RE.test(item.name))
          .map((item) => item.name)
          .sort(compareVersionsDesc);
      } catch {
        return [];
      }
    },

    async keys() {
      try {
        const items = await readdir(root, { withFileTypes: true });
        return items
          .filter((item) => item.isDirectory() && KEY_RE.test(item.name))
          .map((item) => item.name)
          .sort();
      } catch {
        return [];
      }
    },

    async removeVersion(key, version) {
      // The pin is a sibling, so it has to be removed explicitly — otherwise a
      // discarded version leaves a stray pin that a later re-stage would find
      // already present.
      await rm(dirFor(key, version), { recursive: true, force: true });
      await rm(pinFor(key, version), { force: true });

      // Sweep the key directory when its last version goes.
      //
      // Without this, discarding the only staged version leaves an empty
      // `<root>/<key>/` behind, and `keys()` — which matches directory NAMES
      // against the key grammar — goes on reporting an add-on that has no bytes
      // anywhere. Anything reading `keys()` as "what is on disk" would then be
      // reading a lie that accumulates one directory per discard.
      //
      // Guarded on emptiness rather than assumed: an upgrade prunes an old
      // version while a newer one is still present, and that must not take the
      // key with it.
      const keyDir = resolve(join(root, key));
      try {
        if ((await readdir(keyDir)).length === 0) {
          await rm(keyDir, { recursive: true, force: true });
        }
      } catch {
        // Already gone, or never there. Both are the state this wanted.
      }
    },

    async removeKey(key) {
      if (!KEY_RE.test(key)) {
        throw new AddOnStoreError('UNSAFE_KEY', `unsafe add-on key: ${JSON.stringify(key)}`);
      }
      const target = resolve(join(root, key));
      if (target !== join(root, key) || !target.startsWith(root + sep)) {
        throw new AddOnStoreError('PATH_ESCAPES_ROOT', `add-on key escapes the store root: ${key}`);
      }
      await rm(target, { recursive: true, force: true });
    },

    async pruneTemp() {
      let removed = 0;
      let items;
      try {
        items = await readdir(root, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const item of items) {
        if (!item.isDirectory()) continue;
        // Both kinds of debris an interrupted stage can leave: the half-written
        // tree, and a superseded tree that was renamed aside and never put back
        // because the process died between the two renames.
        if (!item.name.startsWith(TEMP_PREFIX) && !item.name.startsWith(BACKUP_PREFIX)) continue;
        await rm(join(root, item.name), { recursive: true, force: true });
        removed += 1;
      }
      return removed;
    },

    async readCatalogCache() {
      try {
        const raw = await readFile(join(root, CATALOG_CACHE_FILE), 'utf8');
        const parsed = JSON.parse(raw) as { fetchedAt?: unknown; document?: unknown };
        if (typeof parsed.fetchedAt !== 'number') return null;
        return { fetchedAt: parsed.fetchedAt, document: parsed.document };
      } catch {
        // Absent, unreadable, or corrupt all mean the same thing to a caller:
        // there is no cached catalog, so browse the bundled set.
        return null;
      }
    },

    async writeCatalogCache(document, at) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const target = join(root, CATALOG_CACHE_FILE);
      // Same temp-then-rename discipline as a package: a crash mid-write must
      // not leave a half-document that the next boot reads as the catalog.
      const temp = `${target}.partial`;
      await writeFile(temp, `${JSON.stringify({ fetchedAt: at, document })}\n`, { mode: 0o600 });
      await rename(temp, target);
    },
  };
}

/**
 * Seeds the store from the image's bundled package set (D3), copy-if-absent.
 *
 * The bundled tarballs ship with a sidecar `<name>.integrity` file written at
 * image-build time, and the seed goes through {@link AddOnStore.stage} like any
 * other source — so "pre-verified" means the hash is re-checked on the way in,
 * not that verification is skipped. A bundled package whose bytes no longer
 * match its sidecar is a corrupt image, and is reported rather than installed.
 */
export async function seedBundledPackages(
  store: AddOnStore,
  bundleDir: string,
  log: (message: string, data?: Record<string, unknown>) => void = () => {},
): Promise<{ seeded: string[]; skipped: string[]; failed: string[] }> {
  const seeded: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  let items: string[];
  try {
    items = await readdir(bundleDir);
  } catch {
    return { seeded, skipped, failed };
  }

  for (const name of items.filter((n) => n.endsWith('.tgz')).sort()) {
    // `<key>-<version>.tgz`, and the split point is the LAST hyphen before the
    // version — anchored from the right, not with a lazy prefix.
    //
    // A lazy `(?<key>[a-z][a-z0-9-]*?)-` stops at the FIRST hyphen that leaves a
    // parseable remainder, so `add-on-design-studio-1.0.0.tgz` yielded the key
    // `add`, and the package would have been staged under a key nothing asks
    // for and nothing can find. Every first-party key contains hyphens, so this
    // was not a corner case: it was most of them.
    const match = /^(?<key>[a-z][a-z0-9-]*)-(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tgz$/.exec(
      name,
    );
    const key = match?.groups?.['key'];
    const version = match?.groups?.['version'];
    if (key === undefined || version === undefined) {
      log('bundled add-on has an unreadable filename', { name });
      failed.push(name);
      continue;
    }

    let alreadyThere = false;
    try {
      // `dirFor` THROWS on a key or version the grammar refuses, and it is
      // called on a filename from the image — so the probe has to be inside the
      // guarded region, not beside it. Before this, one crafted filename in the
      // bundle directory threw out of the loop and silently ended the seed.
      alreadyThere = (await stat(store.dirFor(key, version)).catch(() => undefined)) !== undefined;
    } catch (err) {
      log('bundled add-on has an unusable key or version', { name, error: String(err) });
      failed.push(name);
      continue;
    }
    if (alreadyThere) {
      skipped.push(`${key}@${version}`);
      continue;
    }

    try {
      const tarball = await readFile(join(bundleDir, name));
      const expected = (await readFile(join(bundleDir, `${name}.integrity`), 'utf8')).trim();
      await store.stage({
        key,
        version,
        tarball: new Uint8Array(tarball),
        expectedIntegrity: expected,
      });
      seeded.push(`${key}@${version}`);
    } catch (err) {
      // Per-package, deliberately: one corrupt bundle entry must not cost the
      // deployment the other five. The failure is reported and the loop
      // continues, because a boot seed that aborts on the first problem leaves
      // an air-gapped install with a partly-populated store and no signal about
      // which packages never arrived.
      log('bundled add-on failed to seed', { name, error: String(err) });
      failed.push(name);
    }
  }

  return { seeded, skipped, failed };
}
