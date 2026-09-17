// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `files.migrate` — move stored bytes between destinations.
 *
 * COPY, VERIFY, FLIP, THEN DELETE — in that order, per object, and the order
 * is the whole design. Every other ordering has a window in which a crash
 * loses bytes:
 *
 *   flip first  → the row names an object that is not there yet
 *   delete first → nothing to retry from
 *   flip and delete together → a partial write leaves one of the two undone
 *
 * As written, a kill at any point leaves either (a) the row still pointing at
 * the source, with an orphaned copy at the target that the next run overwrites
 * byte-identically, or (b) the row pointing at the target with the source
 * object still present — litter, never loss. The job resumes from the last id
 * it flipped, so a re-run finishes the work rather than redoing it.
 *
 * THE SHA256 IS RE-COMPUTED FROM WHAT LANDED, not trusted from the row. A copy
 * that silently truncated — a proxy closing a connection, a bucket accepting a
 * short PUT — would otherwise be flipped to and the source deleted, which is
 * the one way this job could destroy data. Verification costs one extra read
 * of each object and is not optional.
 *
 * WHAT IT DOES NOT DO: rewrite references inside a customer's table (D20). An
 * `id`-shaped or Adminium-URL reference stays valid by construction. A
 * reference minted from a destination's `publicBaseUrl` keeps pointing at the
 * old base — so the summary counts how many moved files could be named that
 * way, and the operator is told rather than surprised.
 */

import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

import { z } from 'zod';
import { destinationsRepo, filesRepo, type DsnCrypto, type FileKind, type MetaDb } from '@adminium/meta';

import type { FileStore } from '../files/store.js';
import type { createJobRegistry } from './registry.js';

export const FILES_MIGRATE_KIND = 'files.migrate';

export const filesMigratePayload = z.object({
  /** `null` is this server's disk — the implicit destination (D3). */
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
  kinds: z.array(z.string().min(1)).optional(),
  /** Who asked; the audit row is already written by the route. */
  userId: z.string().min(1).nullable().optional(),
});
export type FilesMigratePayload = z.infer<typeof filesMigratePayload>;

export interface FilesMigrateDeps {
  meta: MetaDb;
  storage: FileStore;
  storageCrypto: DsnCrypto;
}

export interface FilesMigrateResult {
  moved: number;
  skipped: number;
  failed: number;
  /**
   * How many moved files sat on a destination that publishes a `publicBaseUrl`
   * — i.e. how many references in customer tables may now point at the old
   * base. Not a failure; a fact the operator has to be told (D20).
   */
  publicRefsAffected: number;
}

/** One page at a time: a store with 200k files must not become one query. */
const PAGE = 50;

export function registerFilesMigrateHandler(
  registry: ReturnType<typeof createJobRegistry>,
  deps: FilesMigrateDeps,
): void {
  registry.registerJobHandler(
    FILES_MIGRATE_KIND,
    filesMigratePayload,
    async (payload, ctx): Promise<FilesMigrateResult> => {
      const files = filesRepo(deps.meta);
      const destinations = destinationsRepo(deps.meta, deps.storageCrypto);

      const [source, target] = await Promise.all([
        deps.storage.driverFor(payload.from),
        deps.storage.driverFor(payload.to),
      ]);
      const fromRow = payload.from === null ? null : await destinations.findById(payload.from);
      const publishesPublicBase =
        fromRow !== null && 'publicBaseUrl' in fromRow.config && fromRow.config.publicBaseUrl !== undefined;

      const result: FilesMigrateResult = { moved: 0, skipped: 0, failed: 0, publicRefsAffected: 0 };
      let after: string | undefined;
      let seen = 0;

      for (;;) {
        if (ctx.signal.aborted) break;
        const page = await files.listByDestination(payload.from, {
          limit: PAGE,
          ...(after === undefined ? {} : { after }),
          ...(payload.kinds === undefined ? {} : { kinds: payload.kinds as FileKind[] }),
        });
        if (page.length === 0) break;

        for (const file of page) {
          if (ctx.signal.aborted) break;
          seen += 1;
          try {
            const key = target.keyFor({
              id: file.id,
              kind: file.kind,
              filename: file.filename,
              createdAt: file.createdAt,
            });

            // 1. COPY, through the server (D9's rule applies to this too: there
            //    is no server-side copy that would work across drivers, and one
            //    that existed for s3→s3 only would skip the verification).
            const opened = await source.open(file.storageKey);
            const hash = createHash('sha256');
            let bytes = 0;
            const spool = await deps.storage.openWriter({
              id: file.id,
              kind: file.kind,
              filename: file.filename,
              mime: file.mime,
              destinationId: payload.to,
            });
            await pipeline(
              opened.stream,
              new Writable({
                write(chunk: Buffer, _enc, done) {
                  hash.update(chunk);
                  bytes += chunk.byteLength;
                  spool.write(chunk).then(() => done(), done);
                },
              }),
            );
            const landed = await spool.close();

            // 2. VERIFY what landed — see the header on why this is not optional.
            if (landed.sha256 !== file.sha256 || hash.digest('hex') !== file.sha256) {
              await target.remove(landed.storageKey).catch(() => undefined);
              result.failed += 1;
              ctx.log('checksum mismatch after copy; source left untouched', {
                fileId: file.id,
                expected: file.sha256,
                got: landed.sha256,
                bytes,
              });
              continue;
            }

            // 3. FLIP — one UPDATE carrying destination AND key together, so
            //    the row never names bytes that are not there.
            await files.flipDestination(file.id, {
              destinationId: payload.to,
              storageKey: landed.storageKey,
              storage: target.kind,
            });

            // 4. DELETE the source. Idempotent, and a failure here is litter
            //    rather than loss — the row already points at the good copy.
            await source.remove(file.storageKey).catch((error: unknown) => {
              ctx.log('could not remove the source object after a verified move', {
                fileId: file.id,
                key: file.storageKey,
                error: error instanceof Error ? error.message : String(error),
              });
            });

            result.moved += 1;
            if (publishesPublicBase) result.publicRefsAffected += 1;
            // `key` is computed above only to name the target; the authority is
            // what `openWriter` actually wrote, which is why the flip uses
            // `landed.storageKey` rather than this.
            void key;
          } catch (error) {
            result.failed += 1;
            ctx.log('could not move a file', {
              fileId: file.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Resume AFTER the last row of the page whether or not it moved: a row
        // that failed must not make the job loop on it forever. The failure is
        // logged and counted, and a re-run retries it.
        after = page.at(-1)?.id;
        ctx.progress(Math.min(95, 5 + Math.floor((result.moved / Math.max(seen, 1)) * 90)), {
          step: 'moving',
          message: `${String(result.moved)} moved, ${String(result.failed)} failed`,
        });
        if (page.length < PAGE) break;
      }

      ctx.log('files.migrate finished', { ...result });
      return result;
    },
    { internal: true },
  );
}
