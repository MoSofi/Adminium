// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App acquisition jobs (b, G8-D3/D5): refresh the app catalog, and download one
 * release into the app store.
 *
 * The add-on acquisition jobs' twins (`add-on-acquire.ts`), kept apart because
 * the two catalogs are separate documents behind separate switches (R1, R2),
 * cache into separate stores, and audit under separate categories. What they
 * share is the rules:
 *
 *  - `app-download` IS INTERNAL-ONLY. Its payload names a `(key, version)` that
 *    the job resolves against the CACHED CATALOG, which is where the integrity
 * value comes from. A caller who could hand-craft the payload through `POST
 *    /jobs` would be choosing their own fingerprint.
 *  - ONE ATTEMPT PER DOWNLOAD (48 A16, R5). A released file never changes, so a
 *    refusal repeats identically on every retry.
 *  - IDEMPOTENT PER `(key, version)` through the repo's `dedupeKey`.
 *  - A MINIMUM IS CHECKED BEFORE A BYTE IS FETCHED (G8-D2). The route checks it
 *    too, so the page can say so at once; the job checks again because the cache
 *    it reads may have been refreshed between the click and the run.
 */

import { auditRepo, jobsRepo, type Job, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { AddOnCatalogError } from '../add-ons/catalog.js';
import {
  appCatalogSchema,
  isCurrentAppCatalogFormat,
  meetsMinimum,
  type AppCatalogClient,
  type AppCatalogEntry,
} from '../apps/catalog.js';
import type { AppStore } from '../apps/store.js';
import { APP_VERSION } from '../version.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const APP_DOWNLOAD_KIND = 'app-download';
export const APP_CATALOG_REFRESH_KIND = 'app-catalog-refresh';

/** 48 A16 / R5: a refused download is final, so there is nothing to retry. */
export const APP_DOWNLOAD_MAX_ATTEMPTS = 1;

export const appDownloadPayloadSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
  version: z.string().min(1).max(64),
  /** Owner convention (routes/jobs): the requesting user. */
  userId: z.string().optional(),
});
export type AppDownloadPayload = z.infer<typeof appDownloadPayloadSchema>;

export const appCatalogRefreshPayloadSchema = z.object({ userId: z.string().optional() });
export type AppCatalogRefreshPayload = z.infer<typeof appCatalogRefreshPayloadSchema>;

export function appDownloadDedupeKey(key: string, version: string): string {
  return `${APP_DOWNLOAD_KIND}:${key}@${version}`;
}

export interface AppAcquireDeps {
  meta: MetaDb;
  store: AppStore;
  catalog: AppCatalogClient;
  now?: (() => number) | undefined;
  /** Tests only; production checks minimums against the running version. */
  serverVersion?: string | undefined;
}

/** An acquisition event under the `app` audit category, written by the worker. */
async function audit(
  deps: AppAcquireDeps,
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
      category: 'app',
      action,
      changes: { after: { ...(key === null ? {} : { key }), ...data } },
    },
    (deps.now ?? Date.now)(),
  );
}

/** One row of the last cached app catalog, or a refusal saying what to do. */
export async function appEntryFromCache(store: AppStore, key: string, version: string): Promise<AppCatalogEntry> {
  const cached = await store.readCatalogCache();
  if (cached === null || !isCurrentAppCatalogFormat(cached.document)) {
    throw new AddOnCatalogError(
      'UNKNOWN_APP',
      'no app catalog has been fetched yet; refresh the app catalog before downloading',
    );
  }
  const parsed = appCatalogSchema.safeParse(cached.document);
  if (!parsed.success) {
    throw new AddOnCatalogError('CATALOG_MALFORMED', 'the cached app catalog is not readable');
  }
  const entry = parsed.data.apps.find((a) => a.key === key && a.version === version);
  if (entry === undefined) {
    throw new AddOnCatalogError('UNKNOWN_APP', `the app catalog does not offer ${key}@${version}`);
  }
  return entry;
}

export function registerAppAcquireHandlers(registry: JobRegistry, deps: AppAcquireDeps): void {
  const now = deps.now ?? Date.now;
  const serverVersion = deps.serverVersion ?? APP_VERSION;

  registry.registerJobHandler(
    APP_DOWNLOAD_KIND,
    appDownloadPayloadSchema,
    async (payload: AppDownloadPayload, ctx: JobHandlerContext) => {
      const { key, version } = payload;
      const label = `${key}@${version}`;

      ctx.progress(5, { step: 'catalog', message: `Looking up ${label}` });
      const entry = await appEntryFromCache(deps.store, key, version);
      if (!meetsMinimum(entry.minAdminiumVersion, serverVersion)) {
        await audit(
          deps,
          'app.download-failed',
          key,
          { version, reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: entry.minAdminiumVersion, serverVersion },
          payload.userId,
        );
        throw new AddOnCatalogError(
          'REQUIRES_NEWER_ADMINIUM',
          `${label} needs Adminium ${entry.minAdminiumVersion} or later; this server is ${serverVersion}`,
        );
      }
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      ctx.progress(20, { step: 'download', message: `Downloading ${label}` });
      let tarball;
      try {
        tarball = await deps.catalog.fetchTarball(entry, ctx.signal);
      } catch (err) {
        await audit(
          deps,
          'app.download-failed',
          key,
          { version, reason: err instanceof AddOnCatalogError ? err.reason : 'UNKNOWN' },
          payload.userId,
        );
        throw err;
      }
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      // Verify + hardened unpack + atomic stage, all inside the store, against
      // the row's integrity and never a value the download host supplied.
      ctx.progress(70, { step: 'verify', message: 'Verifying and unpacking' });
      let staged;
      try {
        staged = await deps.store.stage({ key, version, tarball, expectedIntegrity: entry.integrity });
      } catch (err) {
        const reason = (err as { reason?: string }).reason ?? 'UNKNOWN';
        await audit(
          deps,
          reason === 'INTEGRITY_MISMATCH' ? 'app.verify-refused' : 'app.unpack-refused',
          key,
          { version, reason, bytes: tarball.byteLength },
          payload.userId,
        );
        throw err;
      }

      ctx.progress(100, { step: 'staged', message: `${label} is ready to install` });
      await audit(
        deps,
        'app.staged',
        key,
        {
          version,
          integrity: staged.tree.integrity,
          source: 'download',
          files: Object.keys(staged.tree.files).length,
        },
        payload.userId,
      );
      return { key, version, integrity: staged.tree.integrity };
    },
    { internal: true },
  );

  registry.registerJobHandler(
    APP_CATALOG_REFRESH_KIND,
    appCatalogRefreshPayloadSchema,
    async (payload: AppCatalogRefreshPayload, ctx: JobHandlerContext) => {
      // The gate runs inside the client before any URL is built. A tick on an
      // instance with the switch off is a no-op, not a failure.
      if (!(await deps.catalog.isEnabled())) {
        ctx.progress(100, { step: 'skipped', message: 'The online app catalog is off' });
        return { refreshed: false, reason: 'disabled' };
      }

      ctx.progress(20, { step: 'fetch', message: 'Fetching the app catalog' });
      let catalog;
      try {
        catalog = await deps.catalog.fetchCatalog(ctx.signal);
      } catch (err) {
        await audit(
          deps,
          'app.catalog-refresh-failed',
          null,
          { reason: err instanceof AddOnCatalogError ? err.reason : 'UNKNOWN' },
          payload.userId,
        );
        throw err;
      }
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

      await deps.store.writeCatalogCache(catalog, now());
      ctx.progress(100, { step: 'cached', message: `${catalog.apps.length} apps listed` });
      await audit(
        deps,
        'app.catalog-refreshed',
        null,
        { count: catalog.apps.length, generatedAt: catalog.generatedAt },
        payload.userId,
      );
      return { refreshed: true, count: catalog.apps.length };
    },
  );
}

/** Enqueue one download, idempotent per `(key, version)`. Routes call this, never `POST /jobs`. */
export async function enqueueAppDownload(
  meta: MetaDb,
  input: { key: string; version: string; userId?: string | undefined },
): Promise<Job> {
  return jobsRepo(meta).enqueue({
    kind: APP_DOWNLOAD_KIND,
    payload: {
      key: input.key,
      version: input.version,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
    },
    dedupeKey: appDownloadDedupeKey(input.key, input.version),
    maxAttempts: APP_DOWNLOAD_MAX_ATTEMPTS,
  });
}

/** Enqueue an app catalog refresh (the scheduled tick and the operator's button). */
export async function enqueueAppCatalogRefresh(
  meta: MetaDb,
  input: { userId?: string | undefined } = {},
): Promise<Job> {
  return jobsRepo(meta).enqueue({
    kind: APP_CATALOG_REFRESH_KIND,
    payload: input.userId === undefined ? {} : { userId: input.userId },
    dedupeKey: APP_CATALOG_REFRESH_KIND,
  });
}
