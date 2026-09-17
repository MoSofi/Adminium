// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The upload spool.
 *
 * Every byte Adminium stores lands here FIRST — on this server's own disk,
 * under `<dataDir>/tmp/upload_<ulid>` — and only then goes to the driver.
 *
 * WHY, when "stream straight into the bucket" is the obvious design:
 *
 *  1. A remote PUT needs an exact `Content-Length` and, signed the way this
 *     server signs (the real payload hash, never `UNSIGNED-PAYLOAD`, so a
 *     plain-HTTP MinIO in dev is signed identically to production), the sha256
 *     of the whole body. Both are known only after the last byte.
 *  2. The size cap must fire BEFORE the bucket has the object; aborting a
 *     stream that is already half-way into S3 leaves an object to clean up.
 *  3. The sniffing gate (D8) must see the head BEFORE anything is committed.
 *  4. A browser upload may arrive chunked, with no length at all.
 *
 * On the local driver the spool IS the write: the finished temp file is
 * renamed into place, so a local upload costs one write, not two. On a host
 * with no persistent disk (DigitalOcean App Platform) the container's
 * ephemeral disk is exactly what a spool is for — the bytes live there for the
 * length of one request.
 *
 * The dir is created 0o700 and the files 0o600: a spooled upload is somebody's
 * document sitting in a shared tmp for a moment.
 */

import { createHash } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { newId } from '@adminium/meta';

import { SNIFF_HEAD_BYTES } from './sniff.js';

export const TMP_DIR = 'tmp';

/** The upload exceeded `files.maxBytes`; the spool file is already gone. */
export class SpoolTooLargeError extends Error {
  override readonly name = 'SpoolTooLargeError';
  constructor(readonly maxBytes: number) {
    super(`upload exceeds the ${String(maxBytes)}-byte limit`);
  }
}

export interface SpooledFile {
  /** Absolute path to the temp file. Valid until `release()`. */
  path: string;
  sizeBytes: number;
  sha256: string;
  /** The first {@link SNIFF_HEAD_BYTES} bytes, held for the sniffing gate. */
  head: Buffer;
  /** Delete the temp file. Idempotent; safe to call after the driver has taken it. */
  release(): Promise<void>;
}

export interface Spool {
  readonly root: string;
  /** Drain a request body (or any readable) into a temp file. */
  spool(source: Readable, opts: { maxBytes: number }): Promise<SpooledFile>;
  /** Incremental writer for producers that push (export-run streams pages in). */
  openWriter(opts?: { maxBytes?: number }): Promise<SpoolWriter>;
}

export interface SpoolWriter {
  write(chunk: Buffer | string): Promise<void>;
  /** Finish and hand over the spooled file. */
  close(): Promise<SpooledFile>;
  /** Finish and delete (failure paths). */
  abort(): Promise<void>;
}

/**
 * Accumulates size, sha256 and the head while bytes flow past. Shared by both
 * entry points so a streamed export and a posted upload are measured
 * identically — the export path used to compute its own hash, and two
 * implementations of "what is this file's sha256" is one too many.
 */
class Meter {
  readonly hash = createHash('sha256');
  private readonly headParts: Buffer[] = [];
  private headLength = 0;
  size = 0;

  add(chunk: Buffer): void {
    this.hash.update(chunk);
    this.size += chunk.byteLength;
    if (this.headLength < SNIFF_HEAD_BYTES) {
      const want = Math.min(chunk.byteLength, SNIFF_HEAD_BYTES - this.headLength);
      this.headParts.push(chunk.subarray(0, want));
      this.headLength += want;
    }
  }

  head(): Buffer {
    return Buffer.concat(this.headParts, this.headLength);
  }
}

/**
 * Tear a sink down and delete what it wrote — and WAIT for the teardown first.
 *
 * `createWriteStream` opens its fd asynchronously, so on a short-lived stream
 * the `open` can still be in flight when the failure path fires. Calling `rm`
 * at that moment removes nothing (the entry does not exist yet) and the open
 * then creates the file the abort was supposed to erase — an orphaned spool
 * file left behind by exactly the paths that exist to prevent one. Waiting for
 * `close` puts the two in order.
 */
async function discard(sink: WriteStream, path: string): Promise<void> {
  if (!sink.destroyed) {
    await new Promise<void>((resolve) => {
      sink.once('close', () => resolve());
      sink.destroy();
    });
  }
  await rm(path, { force: true });
}

export function createSpool(opts: { dataDir: string }): Spool {
  const root = join(opts.dataDir, TMP_DIR);

  async function newTempPath(): Promise<string> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    // `upload_<ULID>` rather than a random name: the prefix makes an orphaned
    // spool file identifiable at a glance, and the ULID sorts by age, so "which
    // of these did a crash leave behind" is answerable from the listing.
    return join(root, `upload_${newId('file').slice('file_'.length)}`);
  }

  function spooled(path: string, meter: Meter): SpooledFile {
    let released = false;
    return {
      path,
      sizeBytes: meter.size,
      sha256: meter.hash.digest('hex'),
      head: meter.head(),
      async release() {
        if (released) return;
        released = true;
        await rm(path, { force: true });
      },
    };
  }

  return {
    root,

    async spool(source, { maxBytes }) {
      const path = await newTempPath();
      const meter = new Meter();
      const sink = createWriteStream(path, { mode: 0o600 });

      /**
       * `for await` rather than `stream.pipeline`, and the reason is not style.
       *
       * `pipeline` waits for the SOURCE to finish tearing down before it
       * settles, and a Fastify request body never reports that: with the
       * gate's write callback erroring on the first over-size chunk, the
       * returned promise simply never resolves and the request hangs until the
       * client gives up. (Found by the route suite's 413 test timing out at
       * five seconds, then reproduced down to `pipeline(request.body,
       * erroringWritable)` on its own — the spool's own unit tests passed
       * throughout, because `Readable.from` tears down cleanly and a request
       * body does not.)
       *
       * The async iterator gives the same backpressure — it pauses between
       * chunks — and hands teardown back to this function, which is where the
       * decision belongs anyway: on overflow the source is destroyed
       * explicitly, so a client streaming gigabytes is cut off rather than
       * drained.
       */
      try {
        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          meter.add(buffer);
          if (meter.size > maxBytes) {
            source.destroy();
            await discard(sink, path);
            throw new SpoolTooLargeError(maxBytes);
          }
          if (!sink.write(buffer)) {
            await new Promise<void>((resolve) => sink.once('drain', () => resolve()));
          }
        }
      } catch (error) {
        if (error instanceof SpoolTooLargeError) throw error;
        await discard(sink, path);
        throw error;
      }

      await new Promise<void>((resolve, reject) => {
        sink.end((closeError?: Error | null) => (closeError ? reject(closeError) : resolve()));
      });
      return spooled(path, meter);
    },

    async openWriter(writerOpts = {}) {
      const path = await newTempPath();
      const meter = new Meter();
      const max = writerOpts.maxBytes;
      const sink = createWriteStream(path, { mode: 0o600 });
      let done = false;
      return {
        async write(chunk) {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
          meter.add(buffer);
          if (max !== undefined && meter.size > max) {
            done = true;
            await discard(sink, path);
            throw new SpoolTooLargeError(max);
          }
          if (!sink.write(buffer)) {
            await new Promise<void>((resolve) => sink.once('drain', () => resolve()));
          }
        },
        async close() {
          if (done) throw new Error('spool writer already finished');
          done = true;
          await new Promise<void>((resolve, reject) => {
            sink.end((error?: Error | null) => (error ? reject(error) : resolve()));
          });
          // `end`'s callback fires before the fd is closed on some platforms;
          // stat is the cheap proof the bytes are durable enough to rename.
          await stat(path);
          return spooled(path, meter);
        },
        async abort() {
          if (done) return;
          done = true;
          await discard(sink, path);
        },
      };
    },
  };
}
