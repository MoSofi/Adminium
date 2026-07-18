/**
 * Local file storage for adminium_files bytes (07-meta-store.md §3.27, v1
 * `storage = 'local'`): artifacts live under `<dataDir>/files/<id>` where
 * `<id>` is the adminium_files row id (`file_<ULID>`), so the row IS the
 * only name a byte blob ever has.
 *
 * FAIL-CLOSED PATH HANDLING (the demo-seed/backup discipline): a storage key
 * is accepted only when it matches the prefixed-ULID grammar — no separators,
 * no dots, no traversal — AND the resolved path still lives under the storage
 * root. Both checks throw; nothing outside `<dataDir>/files/` is ever read,
 * written, or deleted, whatever a database row claims.
 */

import { createHash } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { isId } from '@adminium/meta';

export const FILES_DIR = 'files';

export class FileStorageError extends Error {
  override readonly name = 'FileStorageError';
}

/** `file_<26 Crockford chars>` — the only storage-key shape `local` supports. */
export function isSafeStorageKey(key: string): boolean {
  return isId(key, 'file');
}

export interface WrittenBytes {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

/** Incremental writer for large artifacts (export jobs stream pages in). */
export interface FileWriter {
  write(chunk: Buffer | string): Promise<void>;
  /** Close the handle and report size + sha256 of everything written. */
  close(): Promise<WrittenBytes>;
  /** Close and delete (failure paths). */
  abort(): Promise<void>;
}

export interface FileStorage {
  /** Absolute storage root (`<dataDir>/files`). */
  readonly root: string;
  /** Write bytes under `key`; returns size + sha256 of what landed on disk. */
  write(key: string, bytes: Buffer | string): Promise<WrittenBytes>;
  /** Open an incremental writer under `key`. */
  openWriter(key: string): Promise<FileWriter>;
  /** Open a read stream; throws {@link FileStorageError} when missing/unsafe. */
  read(key: string): Promise<ReadStream>;
  /** Byte size on disk (existence probe). */
  size(key: string): Promise<number>;
  /** Remove bytes; missing files are fine (idempotent GC). */
  remove(key: string): Promise<void>;
}

export function createFileStorage(opts: { dataDir: string }): FileStorage {
  const root = resolve(opts.dataDir, FILES_DIR);

  /** Grammar check + containment check — both fail closed. */
  function pathFor(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new FileStorageError(`unsafe storage key: ${JSON.stringify(key)}`);
    }
    const target = resolve(join(root, key));
    if (target !== join(root, key) || !target.startsWith(root + sep)) {
      throw new FileStorageError(`storage key escapes the files root: ${JSON.stringify(key)}`);
    }
    return target;
  }

  return {
    root,

    async write(key, bytes) {
      const target = pathFor(key);
      await mkdir(root, { recursive: true });
      const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
      await writeFile(target, buffer, { mode: 0o600 });
      return {
        storageKey: key,
        sizeBytes: buffer.byteLength,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    },

    async openWriter(key) {
      const target = pathFor(key);
      await mkdir(root, { recursive: true });
      const handle = await open(target, 'w', 0o600);
      const hash = createHash('sha256');
      let sizeBytes = 0;
      return {
        async write(chunk) {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
          hash.update(buffer);
          sizeBytes += buffer.byteLength;
          await handle.write(buffer);
        },
        async close() {
          await handle.close();
          return { storageKey: key, sizeBytes, sha256: hash.digest('hex') };
        },
        async abort() {
          await handle.close();
          await rm(target, { force: true });
        },
      };
    },

    async read(key) {
      const target = pathFor(key);
      try {
        await stat(target);
      } catch {
        throw new FileStorageError(`no bytes stored under ${JSON.stringify(key)}`);
      }
      return createReadStream(target);
    },

    async size(key) {
      const target = pathFor(key);
      try {
        return (await stat(target)).size;
      } catch {
        throw new FileStorageError(`no bytes stored under ${JSON.stringify(key)}`);
      }
    },

    async remove(key) {
      const target = pathFor(key);
      await rm(target, { force: true });
    },
  };
}
