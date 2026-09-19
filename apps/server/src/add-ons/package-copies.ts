// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping installed packages somewhere that survives a redeploy, and bringing
 * them back.
 *
 * ─── THE PROBLEM, IN ONE LINE ─────────────────────────────────────────────
 * An installed package's files live only in `ADMINIUM_DATA_DIR/{apps,add-ons}`.
 * A host with no persistent disk empties that directory on every deploy: the
 * meta row survives, the bytes do not, and nothing in the image can bring back
 * a package the image does not carry.
 *
 * ─── WHY THE COPY GOES THROUGH THE FILE STORE ─────────────────────────────
 * Because a storage key is not a path. `isSafeStorageKey` is `isId(key,
 * 'file')`, so every driver refuses `packages/app/clinic/1.0.0.tgz`; and
 * writing bytes to a destination means spooling, hashing and per-driver
 * differences the file store has already solved. The copy is therefore an
 * ordinary file row under a pre-minted id, and 0037 records which row belongs
 * to which install.
 *
 * `kind: 'package'`, never `'upload'`. The daily sweep collects unattached
 * uploads after 24 hours — a copy written as an upload would be deleted
 * overnight, having never been attached to a record, and the loss would only
 * be discovered by the redeploy it was supposed to survive.
 *
 * ─── A LOCAL DESTINATION IS NOT A COPY ────────────────────────────────────
 * `defaultDestinationId()` answering `null` means this server's own disk,
 * which is the disk being emptied. Writing there would produce a copy that
 * dies with the original and a fingerprint claiming the package is protected.
 * A local default is therefore "nowhere to put it": no copy, no fingerprint,
 * and the honest Missing state if the files ever go.
 *
 * ─── WHAT EACH SIDE PROMISES ──────────────────────────────────────────────
 * `keep` writes bytes FIRST and records them SECOND, so a crash in between
 * leaves an orphaned object rather than a row pointing at bytes that are not
 * there. `restore` verifies BEFORE staging and refuses a mismatch: the
 * destination is shared, writable storage, and its contents are not re-trusted
 * on the way back in — `stage()` re-checks the hash itself, and this passes it
 * the fingerprint from the meta row rather than anything the bucket said.
 *
 * Neither throws for an absent copy. On these hosts absence is the normal
 * case, not an error — a package installed before this shipped, an instance
 * with no destination configured, a destination temporarily unreachable — and
 * the caller's job is to carry on booting and let the package read as Missing.
 */

import { newId } from '@adminium/meta';
import type { FilesRepo, InstalledManifest, ManifestsRepo } from '@adminium/meta';

import type { FileStore } from '../files/store.js';
import { packStagedTree } from './pack.js';
import { sha512Integrity, type AddOnStore } from './store.js';

/** What a copy is called in the file library, for an operator reading it. */
function filenameFor(key: string, version: string): string {
  return `${key}-${version}.tgz`;
}

export interface KeptCopy {
  fileId: string;
  integrity: string;
  sizeBytes: number;
  fileCount: number;
}

export interface PackageCopies {
  /**
   * Pack the staged tree, put it in the storage destination, record it.
   *
   * `null` when there is nothing to do: no durable destination, a copy already
   * recorded, or no staged tree to pack. None of those is a failure, and the
   * boot pass runs this over every install precisely because it is cheap to
   * skip.
   */
  keep(installed: InstalledManifest): Promise<KeptCopy | null>;
  /**
   * Fetch a recorded copy and stage it back.
   *
   * False when there is no copy, the bytes cannot be read, or they do not match
   * the recorded fingerprint. Never throws: a boot that cannot restore must
   * still be a boot.
   */
  restore(installed: InstalledManifest): Promise<boolean>;
}

export interface PackageCopiesDeps {
  files: FileStore;
  filesRepo: FilesRepo;
  manifests: ManifestsRepo;
  /** Apps and add-ons have separate store roots; the row's `kind` picks one. */
  storeFor: (kind: string) => AddOnStore | null;
  log: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;
}

/** Read a stream to the end. Copies are bounded by the archive limits already. */
async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createPackageCopies(deps: PackageCopiesDeps): PackageCopies {
  return {
    async keep(installed) {
      const { row } = installed;
      const ref = { key: row.manifestKey, version: row.version, kind: row.kind };
      if (row.packageIntegrity !== null && row.packageFileId !== null) return null;

      const store = deps.storeFor(row.kind);
      if (store === null) return null;

      const destinationId = await deps.files.defaultDestinationId();
      if (destinationId === null) return null; // the disk being emptied; see the header

      let dir: string;
      try {
        // Throws on a key or version the store's own grammar refuses, which is
        // the gate that keeps a meta row from naming a path.
        dir = store.dirFor(row.manifestKey, row.version);
      } catch {
        return null;
      }

      let packed;
      try {
        packed = await packStagedTree(dir);
      } catch (error) {
        // Nothing to pack is the ordinary case on a wiped volume: this row is
        // one of the ones that needs RESTORING, not keeping.
        deps.log('info', 'no staged files to keep a copy of', {
          ...ref,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }

      const integrity = sha512Integrity(packed.tarball);
      const fileId = newId('file');
      try {
        // Bytes first, row second: a crash between them leaves an object
        // nothing points at, which the operator can ignore, rather than a row
        // promising bytes that are not there, which the restore would trust.
        await deps.files.write({
          id: fileId,
          kind: 'package',
          filename: filenameFor(row.manifestKey, row.version),
          mime: 'application/gzip',
          bytes: Buffer.from(packed.tarball),
          destinationId,
        });
        await deps.manifests.setPackageCopy(row.id, { fileId, integrity });
      } catch (error) {
        deps.log('warn', 'could not keep a copy of an installed package', {
          ...ref,
          destinationId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }

      deps.log('info', 'kept a copy of an installed package', {
        ...ref,
        fileId,
        destinationId,
        sizeBytes: packed.tarball.byteLength,
        fileCount: packed.fileCount,
      });
      return {
        fileId,
        integrity,
        sizeBytes: packed.tarball.byteLength,
        fileCount: packed.fileCount,
      };
    },

    async restore(installed) {
      const { row } = installed;
      const ref = { key: row.manifestKey, version: row.version, kind: row.kind };
      const { packageFileId, packageIntegrity } = row;
      if (packageFileId === null || packageIntegrity === null) {
        deps.log('error', 'no copy of this package is held, so it cannot be restored', ref);
        return false;
      }

      const store = deps.storeFor(row.kind);
      if (store === null) return false;

      try {
        const file = await deps.filesRepo.findById(packageFileId);
        if (file === null || file.deletedAt !== null) {
          deps.log('error', 'the copy of this package is gone from the file library', {
            ...ref,
            fileId: packageFileId,
          });
          return false;
        }

        const bytes = await drain(await deps.files.read(file));
        // `stage` re-checks this itself; passing the META row's fingerprint is
        // what makes that check meaningful, because the alternative would be
        // hashing the bytes and comparing them with themselves.
        await store.stage({
          key: row.manifestKey,
          version: row.version,
          tarball: bytes,
          expectedIntegrity: packageIntegrity,
        });
      } catch (error) {
        deps.log('error', 'could not restore a package from its copy', {
          ...ref,
          fileId: packageFileId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return false;
      }

      deps.log('info', 'restored a package from its copy', { ...ref, fileId: packageFileId });
      return true;
    },
  };
}
