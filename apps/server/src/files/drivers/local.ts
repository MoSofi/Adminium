// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `local` driver — this server's disk.
 *
 * Two roles, one implementation:
 *
 *  • THE IMPLICIT DESTINATION. Root `<dataDir>/files`, keys are bare
 *    `file_<ULID>`, and `adminium_files.destination_id IS NULL` names it. This
 *    is byte-for-byte what `files/storage.ts` has done since M4, which is what
 *    makes wave 0024 a no-op for every existing row and every existing caller.
 *  • A CONFIGURED ROW. Root from `config.root` — a mounted volume, an SMB
 *    mount, a NAS path — for the operator who wants the bytes somewhere
 *    specific on the box. Same key grammar, same guard, different root.
 *
 * FAIL-CLOSED PATH HANDLING, inherited verbatim: a key is accepted only when
 * it matches the prefixed-ULID grammar — no separators, no dots, no traversal
 * — AND the resolved path still lives under the root. Both checks throw.
 * Nothing outside the root is read, written or deleted, whatever a database
 * row claims. The remote drivers get a different guard (`isSafeRemoteKey`)
 * because their keys are paths by design; this one keeps the stricter rule
 * precisely because a filesystem is what is behind it.
 *
 * `put` is a RENAME when the spool and the root share a filesystem, which is
 * the ordinary case (`<dataDir>/tmp` → `<dataDir>/files`) and makes a local
 * upload cost one write rather than two. A configured root on another mount
 * answers `EXDEV`, and then it is a copy — streamed, not `readFile`, because
 * the cap is 2 GiB.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, statfs, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { isId, newId } from '@adminium/meta';

import {
  FileDriverError,
  FileNotFoundError,
  type ByteRange,
  type FileDriver,
  type KeyRequest,
  type OpenedBytes,
  type ProbeResult,
  type PutSource,
} from './driver.js';

export const FILES_DIR = 'files';

/** `file_<26 Crockford chars>` — the only storage-key shape `local` supports. */
export function isSafeStorageKey(key: string): boolean {
  return isId(key, 'file');
}

export interface LocalDriverOptions {
  /** Absolute storage root. `<dataDir>/files` for the implicit destination. */
  root: string;
}

export function createLocalDriver(opts: LocalDriverOptions): FileDriver {
  const root = resolve(opts.root);

  /** Grammar check + containment check — both fail closed. */
  function pathFor(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new FileDriverError(`unsafe storage key: ${JSON.stringify(key)}`);
    }
    const target = resolve(join(root, key));
    if (target !== join(root, key) || !target.startsWith(root + sep)) {
      throw new FileDriverError(`storage key escapes the files root: ${JSON.stringify(key)}`);
    }
    return target;
  }

  async function moveInto(source: string, target: string): Promise<void> {
    await mkdir(root, { recursive: true });
    try {
      await rename(source, target);
      return;
    } catch (error) {
      // EXDEV is the only rename failure a different mount produces; anything
      // else is a real problem and must not be papered over by a silent copy.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
    await copyFile(source, target);
    await unlink(source);
  }

  return {
    kind: 'local',

    keyFor(file: KeyRequest): string {
      // The row id IS the key here — the grammar is the guard (see the header),
      // so there is no dated layout to compose and nothing user-supplied in it.
      return file.id;
    },

    async put(key: string, source: PutSource): Promise<void> {
      const target = pathFor(key);
      await moveInto(source.path, target);
      // 0o600: an uploaded document is somebody's document. `rename` carries
      // the spool's mode, but a cross-device copy does not, so it is restated.
      const handle = await open(target, 'r+');
      try {
        await handle.chmod(0o600);
      } finally {
        await handle.close();
      }
    },

    async open(key: string, range?: ByteRange): Promise<OpenedBytes> {
      const target = pathFor(key);
      let size: number;
      try {
        size = (await stat(target)).size;
      } catch {
        throw new FileNotFoundError(`no bytes stored under ${JSON.stringify(key)}`);
      }
      if (range === undefined) {
        return { stream: createReadStream(target), sizeBytes: size };
      }
      // Clamp rather than refuse: RFC 7233 says a range whose end runs past the
      // object is satisfied by what exists, and the route needs the real
      // Content-Range to answer 206 correctly.
      const start = Math.max(0, Math.min(range.start, Math.max(size - 1, 0)));
      const end = range.end === undefined ? size - 1 : Math.min(range.end, size - 1);
      return {
        stream: createReadStream(target, { start, end }),
        sizeBytes: Math.max(end - start + 1, 0),
        contentRange: `bytes ${String(start)}-${String(end)}/${String(size)}`,
      };
    },

    async head(key: string): Promise<{ sizeBytes: number } | null> {
      const target = pathFor(key);
      try {
        return { sizeBytes: (await stat(target)).size };
      } catch {
        return null;
      }
    },

    async remove(key: string): Promise<void> {
      await rm(pathFor(key), { force: true });
    },

    async probe(): Promise<ProbeResult> {
      const started = Date.now();
      // A real file under a real id, through the real guard — a probe that
      // wrote to a path the driver would never accept would prove nothing.
      const key = newId('file');
      const target = pathFor(key);
      const payload = Buffer.alloc(1024, 0x2e);
      try {
        await mkdir(root, { recursive: true });
        await pipeline(async function* bytes() {
          yield payload;
        }, createWriteStream(target, { mode: 0o600 }));
        const found = await stat(target);
        if (found.size !== payload.byteLength) {
          return { ok: false, error: `probe wrote ${String(payload.byteLength)} bytes and read back ${String(found.size)}` };
        }
        return { ok: true, latencyMs: Date.now() - started };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        await rm(target, { force: true });
      }
    },

    async usage() {
      try {
        const fs = await statfs(root);
        // `bavail` (blocks available to an unprivileged user), not `bfree`:
        // reserved blocks are not space this process can use.
        return { available: Number(fs.bsize) * Number(fs.bavail) };
      } catch {
        // A root that does not exist yet has no meaningful figure, and the
        // usage strip renders bytes-used with or without this.
        return {};
      }
    },
  };
}
