// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /public/pictures/:keyId/:ref/:rowId/:column/:fileId` — A PICTURE ANYONE
 * MAY SEE, for an `<img>` on the app's pages (a dish, a poster).
 *
 * An `<img>` sends no key, no session and often no Origin, so this route asks
 * for none of them: the picture is public by the app's own declaration (an
 * entry's `pictures`). Authority comes from all of these at once, never from
 * the file id alone — ids are handed out in order, so a neighbour's is easy
 * to guess:
 *
 *  - the key, by its id (one app may run as several instances, each with its
 *    own key): live, a customer key, and not bound to a staff screen;
 *  - the entry: one of the key's reads that shows this column as a picture,
 *    to every visitor (no claim, no parent, no code, no session's alone);
 *  - the row: read through that entry's own conditions (an unpublished show,
 *    a dish off the menu, are no rows at all), whose column names EXACTLY this
 *    file — an old address of a replaced picture answers nothing;
 *  - the file: live, on the key's own connection, attached to this very row
 *    (a file id another row's column was made to name is nothing), a PNG,
 *    JPEG, WebP or GIF by what its bytes were found to be, and small
 *    (`picture.ts`).
 *
 * Every refusal is one 404. A picture already seen by this browser is
 * answered 304 before the whole key's count is touched — from the tag in
 * memory, or the first bytes of the cleaned copy; one already cleaned is
 * streamed from its copy beside the file (`picture-store.ts`), never cleaned
 * again; cleaning is bounded (two at once, one per address), and a request
 * past the bound is told to come back (503 with `Retry-After`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { filesRepo, publicKeysRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import type { ConnectionManager } from '../../connections/manager.js';
import type { RecordFilter } from '../../crud/filters.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { parseRecordId, pkLabel } from '../../crud/records.js';
import { runList } from '../../crud/list.js';
import type { FileStore } from '../../files/store.js';
import { combinePredicates } from '../../public-api/claim.js';
import { openPublishableKey } from '../../public-api/keys.js';
import type { PublicRateLimiter, RateDecision } from '../../public-api/limiter.js';
import { fileIdOf } from '../../public-api/private-file.js';
import { createPictureCache, isPictureMime, matchesTag, pictureHeaders, PICTURE_MAX_BYTES, readCapped, type PictureMime } from '../../public-api/picture.js';
import { createPictureStore } from '../../public-api/picture-store.js';
import { mandatoryAt } from '../../public-api/relative-filters.js';
import type { PublicKeyResolver, ResolvedKey } from '../../public-api/resolve.js';
import type { Switches } from '../../public-api/switches.js';
import { availabilityOf } from '../../surfaces/settings.js';
import { publicErrorReply, type PublicErrorCode } from './schema.js';

export const pictureParams = z.object({
  keyId: z.string().min(1).max(64),
  ref: z.string().min(1).max(64),
  rowId: z.string().min(1).max(200),
  column: z.string().min(1).max(128),
  fileId: z.string().min(1).max(64),
});

export interface PictureDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStore | undefined;
  isEnabled: () => Promise<boolean>;
  limiter: PublicRateLimiter;
  resolver: PublicKeyResolver;
  crypto: DsnCrypto;
  switches: Switches;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  fail: (reply: FastifyReply, status: number, code: PublicErrorCode, message: string) => FastifyReply;
  /** The namespace's answer to a browser's preflight (a page may `fetch` a picture). */
  preflight: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/** How long a key's id is remembered as its token: a revoke reaches this route within it (the resolver's own cache is emptied at once). */
const KEY_MEMORY_MS = 30_000;

export function registerPictures(app: FastifyInstance, deps: PictureDeps): void {
  const cache = createPictureCache();
  const kept = deps.storage === undefined ? null : createPictureStore(deps.storage);
  const tokens = new Map<string, { token: string | null; until: number }>();

  /** The token of a key, by its id: remembered a little while, a key that is none too. */
  const tokenOf = async (keyId: string): Promise<string | null> => {
    const at = Date.now();
    const known = tokens.get(keyId);
    if (known !== undefined && known.until > at) return known.token;
    const row = await publicKeysRepo(deps.meta).findById(keyId);
    let token: string | null = null;
    if (row !== null && row.revokedAt === null && (row.expiresAt === null || row.expiresAt > at)) {
      try {
        token = openPublishableKey(deps.crypto, row.tokenEncrypted);
      } catch {
        token = null;
      }
    }
    if (tokens.size > 1000) tokens.clear();
    tokens.set(keyId, { token, until: at + KEY_MEMORY_MS });
    return token;
  };

  const handler = async (request: FastifyRequest<{ Params: z.infer<typeof pictureParams> }>, reply: FastifyReply): Promise<FastifyReply> => {
    const { keyId, ref, rowId, column, fileId } = request.params;
    const none = () => deps.fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
    const refused = (decision: RateDecision) => {
      reply.header('Retry-After', String(decision.retryAfterSeconds));
      return deps.fail(reply, 429, 'PUBLIC_RATE_LIMITED', 'Too many requests.');
    };
    if (!(await deps.isEnabled())) return deps.fail(reply, 503, 'PUBLIC_API_DISABLED', 'The public API is turned off for this instance.');
    const counted = deps.limiter.hitPicture(request.ip);
    if (!counted.allowed) return refused(counted);

    // The key, by its id: an address that keeps naming keys that are none is refused before the lookup.
    const blocked = deps.limiter.resolutionBlocked(request.ip);
    if (blocked !== null) return refused(blocked);
    const token = await tokenOf(keyId);
    const key: ResolvedKey | null = token === null ? null : await deps.resolver.resolve(token);
    if (key === null || key.keyId !== keyId) {
      deps.limiter.failedResolution(request.ip);
      return none();
    }
    // A customer's key, for every visitor: a staff screen's key is no page's.
    if (key.kind !== 'browser' || key.side !== 'customer' || key.requiresStaff !== null) return none();
    if (key.managedBy !== null && request.server.surfaceSettings != null) {
      const availability = availabilityOf(await request.server.surfaceSettings.read(), key.managedBy, 'customer');
      if (availability !== 'ok') return deps.fail(reply, 503, availability === 'app-disabled' ? 'APP_DISABLED' : 'SURFACE_OFF', 'This app is switched off right now.');
    }
    if (key.enabledBy !== null && !(await deps.switches.isOn(key.connectionId, key.enabledBy.table, key.enabledBy.column))) {
      return deps.fail(reply, 503, 'PUBLIC_KEY_OFF', 'This is switched off right now.');
    }

    // The entry: a read of rows that shows this column as a picture, to anyone.
    const resource = key.scope.byRef.get(ref);
    if (
      resource === undefined ||
      resource.kind !== 'records' ||
      !resource.actions.has('read') ||
      !(resource.pictures ?? []).includes(column) ||
      !resource.expose.includes(column) ||
      (resource.files ?? []).includes(column) ||
      resource.claim !== null ||
      (resource.visibleWith ?? null) !== null ||
      (resource.unlockBy ?? null) !== null ||
      // Rows a session's holder alone reads: an <img> carries no session, so there are none (as a read without one).
      resource.sessionOnly === true
    ) {
      return none();
    }
    const view = await deps.viewFor(key.connectionId);
    if (view === null) return none();
    let table;
    let pk;
    try {
      table = view.table(resource.table);
      pk = parseRecordId(table, rowId);
    } catch {
      return none();
    }

    // The row, read as the entry reads it; its column must name this very file.
    const byKey: RecordFilter[] = Object.entries(pk).map(([name, value]) => ({ column: name, op: 'eq', value }) as RecordFilter);
    const keyFilter: RecordFilter = byKey.length === 1 ? byKey[0]! : { and: byKey };
    let value: unknown;
    try {
      const { db, dialect } = await deps.manager.data(key.connectionId);
      const result = await runList({
        db,
        view,
        table,
        params: { limit: 1, count: 'none' },
        canReadPii: false,
        dialect,
        mandatory: combinePredicates(mandatoryAt(resource.where, table, key.scope.timezone), keyFilter) ?? keyFilter,
        exposeColumns: [column],
      });
      value = result.data[0]?.[column];
    } catch {
      return none();
    }
    if (fileIdOf(value) !== fileId) return none();
    // The file as it stands now: gone, moved to another connection, not a picture by its bytes, or too big — nothing.
    const file = await filesRepo(deps.meta).findById(fileId);
    if (
      file === null ||
      file.deletedAt !== null ||
      file.entityConnectionId !== key.connectionId ||
      // The row the file was attached to, and no other: a column made to name another row's file shows nothing.
      file.entityTable !== table.id ||
      file.entityId !== pkLabel(table, pk) ||
      !isPictureMime(file.mime) ||
      file.sizeBytes > PICTURE_MAX_BYTES
    ) {
      return none();
    }
    const storage = deps.storage;
    if (storage === undefined || kept === null) return none();

    // Seen already by this browser: said so before the whole key's count, and before the picture is opened.
    let stored = null;
    let tag = cache.tagOf(fileId);
    if (tag === undefined) {
      stored = await kept.head(file).catch(() => null);
      if (stored !== null) {
        tag = stored.etag;
        cache.remember(fileId, tag);
      }
    }
    if (tag !== undefined && matchesTag(request.headers['if-none-match'], tag)) {
      reply.headers(pictureHeaders({ mime: file.mime as PictureMime, etag: tag }, column));
      return reply.code(304).send();
    }
    const rung = deps.limiter.hitKey(key.keyId, 'picture');
    if (!rung.allowed) return refused(rung);

    // Cleaned before: streamed from its copy beside the file.
    stored ??= await kept.head(file).catch(() => null);
    const streamed = stored === null ? null : await kept.open(file, stored).catch(() => null);
    if (stored !== null && streamed !== null) {
      reply.headers(pictureHeaders(stored, column, streamed.length));
      return reply.send(streamed.stream);
    }

    // Never cleaned (or its copy does not read back): cleaned now, kept, and served.
    let picture;
    try {
      picture = await cache.clean(fileId, request.ip, async () => {
        const opened = await storage.open(file);
        return { bytes: await readCapped(opened.stream, PICTURE_MAX_BYTES), mime: file.mime };
      });
    } catch (error) {
      request.log.info({ fileId, reason: error instanceof Error ? error.message : String(error) }, 'a picture was not served');
      return none();
    }
    if (picture === null) {
      reply.header('Retry-After', '1');
      return deps.fail(reply, 503, 'PUBLIC_UPSTREAM_UNAVAILABLE', 'Busy; try again in a moment.');
    }
    try {
      await kept.save(file, picture);
    } catch (error) {
      // Served all the same; the next visitor cleans it again and tries once more to keep it.
      request.log.warn({ fileId, err: error }, 'a cleaned picture could not be kept');
    }
    if (matchesTag(request.headers['if-none-match'], picture.etag)) {
      reply.headers(pictureHeaders(picture, column));
      return reply.code(304).send();
    }
    reply.headers(pictureHeaders(picture, column, picture.bytes.length));
    return reply.send(picture.bytes);
  };

  app.options('/public/pictures/:keyId/:ref/:rowId/:column/:fileId', { schema: { hide: true } }, deps.preflight);
  app.get(
    '/public/pictures/:keyId/:ref/:rowId/:column/:fileId',
    {
      config: { rateLimitBucket: 'public-picture' },
      schema: { params: pictureParams, response: { 404: publicErrorReply, 429: publicErrorReply, 503: publicErrorReply } },
    },
    handler as never,
  );
}
