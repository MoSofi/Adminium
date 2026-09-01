// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two acquisition job kinds (32-add-on-distribution.md §4.3, D10).
 *
 * WHY JOBS AND NOT REQUEST HANDLERS. A download is a multi-second, multi-step
 * network operation (packument → ledger cross-check → tarball → verify →
 * hardened unpack), and the jobs substrate already carries every property that
 * needs: retries with attempt counts, cooperative cancellation, and — the one
 * that decides it — progress published on the `jobs:<jobId>` WS topic, which
 * the Studio page consumes for free (26 §5.3's argument, applied to
 * acquisition). Running it on the request thread would mean either a held
 * connection or a bespoke progress channel.
 *
 * `add-on-download` IS INTERNAL-ONLY. Its payload names a `(key, version)` that
 * the route resolves against the CACHED CATALOG — that is where the integrity
 * value comes from, and it is the whole trust chain (D7). A `jobs.manage`
 * holder who could hand-craft this payload through the generic `POST /jobs`
 * would be choosing their own integrity value, which is the same as having
 * none. The registry's `internal` flag exists for exactly this class of payload
 * (see `registry.ts`'s note on `export-run`'s `unmasked`).
 *
 * IDEMPOTENCY IS THE REPO'S `dedupeKey`, not a bespoke check: an existing
 * pending/running job with the same key is returned rather than a second one
 * inserted, with a unique index underneath it. Two operators clicking Download
 * on the same version get one download.
 */

import { auditRepo, jobsRepo, type Job, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import {
  AddOnCatalogError,
  catalogSchema,
  type CatalogClient,
  type CatalogEntry,
} from '../add-ons/catalog.js';
import type { AddOnStore } from '../add-ons/store.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const ADD_ON_DOWNLOAD_KIND = 'add-on-download';
export const CATALOG_REFRESH_KIND = 'catalog-refresh';

export const addOnDownloadPayloadSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
  version: z.string().min(1).max(64),
  /** Owner convention (routes/jobs): the requesting user. */
  userId: z.string().optional(),
});
export type AddOnDownloadPayload = z.infer<typeof addOnDownloadPayloadSchema>;

export const catalogRefreshPayloadSchema = z.object({
  /** Absent for the scheduled tick; set when an operator pressed the button. */
  userId: z.string().optional(),
});
export type CatalogRefreshPayload = z.infer<typeof catalogRefreshPayloadSchema>;

/** The dedupe key one `(key, version)` download owns. */
export function downloadDedupeKey(key: string, version: string): string {
  return `${ADD_ON_DOWNLOAD_KIND}:${key}@${version}`;
}

export interface AddOnAcquireDeps {
  meta: MetaDb;
  store: AddOnStore;
  catalog: CatalogClient;
  now?: (() => number) | undefined;
}

/**
 * Records an acquisition event under the `add-on` audit category (§4.3: every
 * refresh, download, verify-refusal, unpack-refusal, upload, staged, deleted
 * and upgraded lands there).
 *
 * This is the `worker` write path in `audit/coverage.ts`'s taxonomy — a bare
 * `auditRepo().append()` with no request in scope, because the route only
 * enqueues and the row is written when the job runs.
 *
 * `entity` stays NULL on purpose. A `RecordRef` addresses a row in a connected
 * source database (`connectionId` + `table` + `pk`); an add-on package is
 * neither, and inventing a synthetic ref would put a non-existent table name
 * into the indexed `entity_table` column that 0016's activity feed filters on.
 * The add-on key travels in `changes.after` instead, where the rest of the
 * acquisition facts already are.
 */
async function audit(
  deps: AddOnAcquireDeps,
  action: string,
  key: string | null,
  data: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  await auditRepo(deps.meta).append(
    {
      actorKind: userId === undefined ? 'system' : 'user',
      actorId: userId ?? null,
      actorLabel: userId ?? 'system',
      category: 'add-on',
      action,
      changes: { after: { ...(key === null ? {} : { key }), ...data } },
    },
    (deps.now ?? Date.now)(),
  );
}

/** Pulls the entry for `(key, version)` out of the last cached catalog. */
async function entryFromCache(
  store: AddOnStore,
  key: string,
  version: string,
): Promise<CatalogEntry> {
  const cached = await store.readCatalogCache();
  if (cached === null) {
    throw new AddOnCatalogError(
      'UNKNOWN_ADD_ON',
      'no catalog has been fetched yet; refresh the catalog before downloading',
    );
  }
  const parsed = catalogSchema.safeParse(cached.document);
  if (!parsed.success) {
    throw new AddOnCatalogError('CATALOG_MALFORMED', 'the cached catalog is not readable');
  }
  const entry = parsed.data.addOns.find((a) => a.key === key && a.version === version);
  if (entry === undefined) {
    throw new AddOnCatalogError(
      'UNKNOWN_ADD_ON',
      `the catalog does not offer ${key}@${version}`,
    );
  }
  return entry;
}

export function registerAddOnAcquireHandlers(
  registry: JobRegistry,
  deps: AddOnAcquireDeps,
): void {
  const now = deps.now ?? Date.now;

  registry.registerJobHandler(
    ADD_ON_DOWNLOAD_KIND,
    addOnDownloadPayloadSchema,
    async (payload: AddOnDownloadPayload, ctx: JobHandlerContext) => {
      const { key, version } = payload;
      const label = `${key}@${version}`;

      ctx.progress(5, { step: 'catalog', message: `Looking up ${label}` });
      const entry = await entryFromCache(deps.store, key, version);
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      // D7 legs 1 + 2: pin from the packument, cross-check against the ledger
      // value the catalog carries. A disagreement never reaches the network.
      ctx.progress(20, { step: 'pin', message: 'Pinning the published version' });
      let pinned;
      try {
        pinned = await deps.catalog.pinRelease(entry, ctx.signal);
      } catch (err) {
        await audit(
          deps,
          'add-on.verify-refused',
          key,
          { version, reason: err instanceof AddOnCatalogError ? err.reason : 'UNKNOWN' },
          payload.userId,
        );
        throw err;
      }
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      ctx.progress(40, { step: 'download', message: `Downloading ${label}` });
      let tarball;
      try {
        tarball = await deps.catalog.fetchTarball(pinned, ctx.signal);
      } catch (err) {
        // Audited like the other two legs. A download that dies at the transport
        // — a redirect off the registry, an over-cap body, a timeout — is
        // exactly the kind of event §4.3 wants on the record, and leaving it as
        // the one silent leg would have made the audit trail's completeness a
        // matter of which failure happened to occur.
        await audit(
          deps,
          'add-on.download-failed',
          key,
          { version, reason: err instanceof AddOnCatalogError ? err.reason : 'UNKNOWN' },
          payload.userId,
        );
        throw err;
      }
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      // Verify + hardened unpack + atomic stage, all inside the store. A hash
      // mismatch or a hostile archive is refused there and audited here.
      ctx.progress(70, { step: 'verify', message: 'Verifying and unpacking' });
      let staged;
      try {
        staged = await deps.store.stage({
          key,
          version,
          tarball,
          expectedIntegrity: pinned.integrity,
        });
      } catch (err) {
        const reason = (err as { reason?: string }).reason ?? 'UNKNOWN';
        await audit(
          deps,
          'add-on.unpack-refused',
          key,
          { version, reason, bytes: tarball.byteLength },
          payload.userId,
        );
        throw err;
      }

      ctx.progress(100, { step: 'staged', message: `${label} is ready to install` });
      await audit(
        deps,
        'add-on.staged',
        key,
        { version, integrity: staged.tree.integrity, source: 'npm', files: Object.keys(staged.tree.files).length },
        payload.userId,
      );

      return { key, version, integrity: staged.tree.integrity, dir: staged.dir };
    },
    { internal: true },
  );

  registry.registerJobHandler(
    CATALOG_REFRESH_KIND,
    catalogRefreshPayloadSchema,
    async (payload: CatalogRefreshPayload, ctx: JobHandlerContext) => {
      // The gate is inside the client and runs before any URL is built, so a
      // scheduled tick on an air-gapped instance is a typed refusal, not a
      // blocked socket. Reported as a no-op rather than a failure: the operator
      // did not do anything wrong by leaving the switch off.
      if (!(await deps.catalog.isEnabled())) {
        ctx.progress(100, { step: 'skipped', message: 'The online catalog is off' });
        return { refreshed: false, reason: 'disabled' };
      }

      ctx.progress(20, { step: 'fetch', message: 'Fetching the catalog' });
      let catalog;
      try {
        catalog = await deps.catalog.fetchCatalog(ctx.signal);
      } catch (err) {
        await audit(
          deps,
          'add-on.catalog-refresh-failed',
          null,
          { reason: err instanceof AddOnCatalogError ? err.reason : 'UNKNOWN' },
          payload.userId,
        );
        throw err;
      }
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      await deps.store.writeCatalogCache(catalog, now());
      ctx.progress(100, { step: 'cached', message: `${catalog.addOns.length} add-ons listed` });
      await audit(
        deps,
        'add-on.catalog-refreshed',
        null,
        { count: catalog.addOns.length, generatedAt: catalog.generatedAt },
        payload.userId,
      );

      return { refreshed: true, count: catalog.addOns.length };
    },
  );
}

/**
 * Enqueue one download, idempotent per `(key, version)`.
 *
 * The route calls this rather than `POST /jobs` — see the internal-only note in
 * this file's header for why that distinction is a security boundary and not a
 * convenience.
 */
export async function enqueueAddOnDownload(
  meta: MetaDb,
  input: { key: string; version: string; userId?: string | undefined },
): Promise<Job> {
  return jobsRepo(meta).enqueue({
    kind: ADD_ON_DOWNLOAD_KIND,
    payload: {
      key: input.key,
      version: input.version,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
    },
    dedupeKey: downloadDedupeKey(input.key, input.version),
  });
}

/** Enqueue a catalog refresh (the scheduled tick and the operator button). */
export async function enqueueCatalogRefresh(
  meta: MetaDb,
  input: { userId?: string | undefined } = {},
): Promise<Job> {
  return jobsRepo(meta).enqueue({
    kind: CATALOG_REFRESH_KIND,
    payload: input.userId === undefined ? {} : { userId: input.userId },
    // One refresh in flight at a time; the scheduler's own no-overlap guard
    // covers the periodic tick, this covers the button racing the tick.
    dedupeKey: CATALOG_REFRESH_KIND,
  });
}
