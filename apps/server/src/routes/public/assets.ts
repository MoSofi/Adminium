// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /public/assets/:keyId/:ref/:rowId/:column/:fileId` — A PRODUCT ASSET
 * ANYONE'S BROWSER MAY LOAD: the shop's preview model a 3D viewer fetches,
 * a print model, a font a page's `@font-face` loads, an SVG piece.
 *
 * The pictures route's authority, unchanged (`pictures.ts`): a viewer's
 * `fetch` and a font load send no key and no session, so the asset is public
 * by the app's own declaration (an entry's `assets`), and authority comes
 * from all of these at once, never from the file id alone:
 *
 *  - the key, by its id: live, a customer key, not bound to a staff screen;
 *  - the entry: one of the key's reads that shows this column as assets, to
 *    every visitor (no claim, no parent, no code, no session's alone);
 *  - the row: read through that entry's own conditions (an unpublished
 *    product is no row at all), whose column names this very file (in a list
 *    of pieces, one of them);
 *  - the file: live, on the key's own connection, attached to this very row,
 *    a model, a font or an SVG by what its bytes were found to be, and within
 *    its kind's cap (`public-api/asset.ts`).
 *
 * Every refusal is one 404. Served as kept (checked or cleaned when it was
 * uploaded), streamed, cached by its id, 304 by its tag before the key's
 * count is touched. Counted as pictures are, per address and per key.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { filesRepo, publicKeysRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';
import { PUBLIC_ASSET_MAX_BYTES } from '@adminium/manifest';
import { z } from 'zod';

import type { ConnectionManager } from '../../connections/manager.js';
import type { RecordFilter } from '../../crud/filters.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { runList } from '../../crud/list.js';
import { parseRecordId, pkLabel } from '../../crud/records.js';
import { fileIdsIn } from '../../files/column-values.js';
import type { FileStore } from '../../files/store.js';
import { assetHeaders, assetKindOf, assetTag } from '../../public-api/asset.js';
import { combinePredicates } from '../../public-api/claim.js';
import { hasVisitorReach, openPublishableKey } from '../../public-api/keys.js';
import type { PublicRateLimiter, RateDecision } from '../../public-api/limiter.js';
import { matchesTag } from '../../public-api/picture.js';
import { mandatoryAt } from '../../public-api/relative-filters.js';
import type { PublicKeyResolver, ResolvedKey } from '../../public-api/resolve.js';
import type { Switches } from '../../public-api/switches.js';
import { withOpenDoors } from '../../rbac/app-parts.js';
import { availabilityOf } from '../../surfaces/settings.js';
import { publicErrorReply, type PublicErrorCode } from './schema.js';

export const assetParams = z.object({
  keyId: z.string().min(1).max(64),
  ref: z.string().min(1).max(64),
  rowId: z.string().min(1).max(200),
  column: z.string().min(1).max(128),
  fileId: z.string().min(1).max(64),
});

export interface AssetDeps {
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
  /** The namespace's answer to a browser's preflight (a viewer `fetch`es a model; a font loads cross-origin). */
  preflight: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/** How long a key's id is remembered as its token: a revoke reaches this route within it (the resolver's own cache is emptied at once). */
const KEY_MEMORY_MS = 30_000;

export function registerAssets(app: FastifyInstance, deps: AssetDeps): void {
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

  const handler = async (request: FastifyRequest<{ Params: z.infer<typeof assetParams> }>, reply: FastifyReply): Promise<FastifyReply> => {
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
    if (!hasVisitorReach(key.kind) || key.side !== 'customer' || key.requiresStaff !== null) return none();
    if (key.managedBy !== null && request.server.surfaceSettings != null) {
      const availability = availabilityOf(await request.server.surfaceSettings.read(), key.managedBy, 'customer');
      if (availability !== 'ok') return deps.fail(reply, 503, availability === 'app-disabled' ? 'APP_DISABLED' : 'SURFACE_OFF', 'This app is switched off right now.');
    }
    if (key.enabledBy !== null && !(await deps.switches.isOn(key.connectionId, key.enabledBy.table, key.enabledBy.column))) {
      return deps.fail(reply, 503, 'PUBLIC_KEY_OFF', 'This is switched off right now.');
    }

    // The entry: a read of rows that shows this column as assets, to anyone, of the key as it stands now.
    const resource = (await withOpenDoors(deps.meta, key)).scope.byRef.get(ref);
    if (
      resource === undefined ||
      resource.kind !== 'records' ||
      !resource.actions.has('read') ||
      !(resource.assets ?? []).includes(column) ||
      !resource.expose.includes(column) ||
      (resource.files ?? []).includes(column) ||
      (resource.pictures ?? []).includes(column) ||
      resource.claim !== null ||
      (resource.visibleWith ?? null) !== null ||
      (resource.unlockBy ?? null) !== null ||
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
    if (!fileIdsIn(value).includes(fileId)) return none();
    // The file as it stands now: gone, moved, not an asset by its bytes, or over its kind's cap — nothing.
    const file = await filesRepo(deps.meta).findById(fileId);
    const kind = file === null ? null : assetKindOf(file.mime);
    if (
      file === null ||
      kind === null ||
      file.deletedAt !== null ||
      file.entityConnectionId !== key.connectionId ||
      // The row the file was attached to, and no other: a column made to name another row's file loads nothing.
      file.entityTable !== table.id ||
      file.entityId !== pkLabel(table, pk)
    ) {
      return none();
    }
    if (file.sizeBytes > PUBLIC_ASSET_MAX_BYTES[kind]) {
      // Saved before its column was held to the public size (or through a door that is not a person's): said in the log, never to the visitor.
      request.log.info({ fileId, sizeBytes: file.sizeBytes, maxBytes: PUBLIC_ASSET_MAX_BYTES[kind] }, 'an asset too large for the public was not served');
      return none();
    }
    const storage = deps.storage;
    if (storage === undefined) return none();

    // Loaded already by this browser: said so before the whole key's count, and before the file is opened.
    if (matchesTag(request.headers['if-none-match'], assetTag(file.sha256))) {
      reply.headers(assetHeaders(file, column, kind));
      return reply.code(304).send();
    }
    const rung = deps.limiter.hitKey(key.keyId, 'picture');
    if (!rung.allowed) return refused(rung);

    let opened;
    try {
      opened = await storage.open(file);
    } catch (error) {
      request.log.info({ fileId, reason: error instanceof Error ? error.message : String(error) }, 'an asset was not served');
      return none();
    }
    reply.headers(assetHeaders(file, column, kind, file.sizeBytes));
    return reply.send(opened.stream);
  };

  app.options('/public/assets/:keyId/:ref/:rowId/:column/:fileId', { schema: { hide: true } }, deps.preflight);
  app.get(
    '/public/assets/:keyId/:ref/:rowId/:column/:fileId',
    {
      config: { rateLimitBucket: 'public-picture' },
      schema: { params: assetParams, response: { 404: publicErrorReply, 429: publicErrorReply, 503: publicErrorReply } },
    },
    handler as never,
  );
}
