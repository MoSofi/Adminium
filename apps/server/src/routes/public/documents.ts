// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which documents a signed-in person may see and ask for through a public
 * key — the rules the `/public/documents*` routes share.
 *
 * ─── A DOCUMENT IS A PERSON'S OWN, ON ONE KEY ──────────────────────────────
 *
 * A document drawn for a row is visible to a session only when ALL of these
 * hold, and any one missing is the same 404 an unknown id gets:
 *
 *  - it was drawn on the key's OWN connection — the same row id on another
 *    database is another business's invoice;
 *  - its profile belongs to the key's owner: the app that made the key (a
 *    profile its install made), or, for an operator's own key, a profile an
 *    operator made;
 *  - a resource on the key reads the row's table, carries a claim, is reached
 *    by this session at the level it asks, and DECLARES the kind — the app's
 *    entry lists it in `documents`, or the operator switched the key's
 *    documents flag on;
 *  - the row itself is inside that resource's mandatory filter and this
 *    session's claim, asked of the database the way a record read asks it.
 *
 * A document drawn from values (an intent) carries the claim and the key that
 * asked for it, and only that key's sessions with that claim see it.
 *
 * ─── THE LIST IS A QUERY, NOT A FILTER OVER THE NEWEST FEW ─────────────────
 *
 * The rows a claim reaches are read first, on each declaring resource (they
 * are one person's rows: an invoice list, a handful of clients), and the
 * register is then asked for exactly the documents of those rows, newest
 * first, keyset-paged. Nobody else's documents are ever read to be thrown
 * away, and a person with sixty old invoices sees all sixty.
 */
import { z } from 'zod';
import type { Kysely } from 'kysely';

import type { AppManifest } from '@adminium/manifest';
import {
  appTablesRepo,
  documentProfilesRepo,
  documentsRepo,
  entityKeyOf,
  manifestsRepo,
  type DocumentCursor,
  type DocumentProfile,
  type DocumentRow,
  type MetaDb,
} from '@adminium/meta';
import { publicDocumentRequestSchema } from '@adminium/add-on-contracts';
import type { Dialect } from '@adminium/engine';

import { planPublicEndpoints } from '../../apps/manifest-public.js';
import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { LIST_LIMIT_MAX, runList } from '../../crud/list.js';
import type { RecordFilter } from '../../crud/filters.js';
import { STATEMENT_PERIODS } from '../../documents/statement.js';
import { claimPredicateFor, combinePredicates, type PublicSessionContext } from '../../public-api/claim.js';
import { mandatoryAt } from '../../public-api/relative-filters.js';
import type { ResolvedKey } from '../../public-api/resolve.js';
import type { CompiledResource } from '../../public-api/scope.js';

/**
 * A render's own limits, apart from the writes a key's visitors make: per
 * visitor (their session, else their address) and for the whole key. Counted
 * on the limiter's endpoint counter under a ref no endpoint can have — a ref
 * is letters, digits and underscores — so they share nothing with accepts,
 * approvals and bookings.
 */
export const DOCUMENT_RENDER_REF = '#documents-render';
export const DOCUMENT_RENDER_LIMITS = {
  visitor: { max: 30, windowMs: 60_000 },
  key: { max: 240, windowMs: 60_000 },
} as const;

/** How many rows of one resource a claim may reach before the list refuses rather than cuts. */
export const CLAIM_ROWS_MAX = 50_000;
/** `entity_id IN (…)` is asked in chunks of this many. */
const IDS_CHUNK = 500;

/** `GET /public/documents`. `ref` + `id` narrow to one row's documents. */
export const publicDocumentsListQuery = z.object({
  ref: z.string().min(1).max(80).optional(),
  id: z.union([z.string().max(200), z.number()]).optional(),
  kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

/**
 * `POST /public/documents/render`, drawn from a row the claim reaches: by the
 * `kind` the key's entry declares (an app's key — the page never needs a
 * profile id), or by `profileId` (an operator's key). A statement names its
 * period, one of three words; no date ever comes from the caller.
 */
const persistedRender = z
  .object({
    profileId: z.string().min(1).max(40).optional(),
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(40).optional(),
    ref: z.string().min(1).max(80),
    id: z.union([z.string().max(200), z.number()]),
    locale: z.string().min(2).max(35).optional(),
    period: z.enum(STATEMENT_PERIODS).optional(),
  })
  .strict()
  .refine((body) => (body.profileId === undefined) !== (body.kind === undefined), {
    message: 'name the document by its kind or its profile, one of the two',
    path: ['kind'],
  });

export const publicDocumentRenderRequest = z.union([persistedRender, publicDocumentRequestSchema]);
export type PersistedRenderBody = z.infer<typeof persistedRender>;

export type PublicAccess = { key: ResolvedKey; session: PublicSessionContext | null };

/** `(createdAt, id)` as an opaque cursor, and back; a malformed one is no cursor at all. */
export function encodeDocumentCursor(row: { createdAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id]), 'utf8').toString('base64url');
}
export function decodeDocumentCursor(raw: string | undefined): DocumentCursor | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'number' && typeof parsed[1] === 'string' && parsed[1].length <= 40) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Newest first, the register's own order. */
function newer(a: DocumentRow, b: DocumentRow): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('documents never store a credential');
  },
  decrypt: (): string => {
    throw new Error('documents never read a credential');
  },
};

export class ClaimTooWideError extends Error {
  constructor() {
    super(`a claim reaches more than ${String(CLAIM_ROWS_MAX)} rows`);
    this.name = 'ClaimTooWideError';
  }
}

export function createDocumentAccess(deps: {
  meta: MetaDb;
  manager: ConnectionManager;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  /** How long the kinds an app's entries declare are remembered; an update narrows within it. */
  ttlMs?: number | undefined;
}) {
  const ttl = deps.ttlMs ?? 10_000;
  const declaredCache = new Map<string, { at: number; value: ReadonlyMap<string, ReadonlySet<string>> }>();

  /**
   * The kinds each ref of this key may list and draw. An app's key: the
   * entries of the app's installed manifest that say `documents`, by the ref
   * the install gave each. An operator's key: every ref, any kind, when its
   * documents flag is on — and nothing when it is off. `null` means "any".
   */
  async function declaredKinds(key: ResolvedKey): Promise<ReadonlyMap<string, ReadonlySet<string> | null>> {
    if (key.managedBy === null) {
      return key.scope.documents.create ? new Map([...key.scope.byRef.keys()].map((ref) => [ref, null])) : new Map();
    }
    const cacheKey = `${key.managedBy}|${key.connectionId}`;
    const cached = declaredCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.at < ttl) return cached.value;

    const out = new Map<string, ReadonlySet<string>>();
    const installed = await manifestsRepo(deps.meta, NO_SECRETS).findByKey(key.managedBy);
    const manifest = installed?.document as AppManifest | undefined;
    // The app's own install, on this key's connection, and nothing else.
    if (installed !== null && installed !== undefined && installed.row.connectionId === key.connectionId && manifest?.kind === 'app') {
      const names = await appTablesRepo(deps.meta).realNames(key.connectionId, key.managedBy);
      const planned = planPublicEndpoints(manifest, names, null);
      (manifest.publicAccess ?? []).forEach((entry, index) => {
        const ref = planned[index]?.ref;
        if (ref !== undefined && entry.documents !== undefined && entry.documents.length > 0) out.set(ref, new Set(entry.documents));
      });
    }
    declaredCache.set(cacheKey, { at: Date.now(), value: out });
    return out;
  }

  /** Whether a session reads this resource's rows as a person's own. */
  function personal(resource: CompiledResource, session: PublicSessionContext): boolean {
    if (resource.kind !== 'records' || !resource.actions.has('read')) return false;
    // A resource with no claim is everybody's: its rows' documents are nobody's to list.
    if (resource.claim === null) return false;
    if (!claimPredicateFor(resource, session).reachable) return false;
    return resource.level !== 'verified' || session.level === 'verified';
  }

  /** The profiles this key's owner made on its connection. */
  async function ownProfiles(key: ResolvedKey): Promise<DocumentProfile[]> {
    const all = await documentProfilesRepo(deps.meta).list({ connectionId: key.connectionId });
    return all.filter((profile) => profile.ownerApp === key.managedBy);
  }

  interface Opened {
    db: Kysely<SourceDatabase>;
    dialect: Dialect;
    view: SnapshotView;
    table: ResolvedTable;
    predicate: RecordFilter | null;
  }

  /** The database, the table and the predicate a resource's rows are read under, or null. */
  async function open(ok: PublicAccess & { session: PublicSessionContext }, resource: CompiledResource): Promise<Opened | null> {
    const view = await deps.viewFor(ok.key.connectionId);
    if (view === null) return null;
    let table: ResolvedTable;
    try {
      table = view.table(resource.table);
    } catch {
      return null;
    }
    let handle;
    try {
      handle = await deps.manager.data(ok.key.connectionId);
    } catch {
      return null;
    }
    const claim = claimPredicateFor(resource, ok.session);
    if (!claim.reachable) return null;
    return {
      db: handle.db,
      dialect: handle.dialect,
      view,
      table,
      predicate: combinePredicates(mandatoryAt(resource.where, table, ok.key.scope.timezone), claim.predicate),
    };
  }

  /** `pk` as the conditions of one row. */
  function byKey(table: ResolvedTable, pk: Readonly<Record<string, unknown>>): RecordFilter {
    const conditions = table.primaryKey.map((column) => ({ column, op: 'eq' as const, value: pk[column] }));
    return conditions.length === 1 ? conditions[0]! : { and: conditions };
  }

  /** Whether the row with this key is one the session reads on the resource. */
  async function reaches(ok: PublicAccess & { session: PublicSessionContext }, resource: CompiledResource, pk: Readonly<Record<string, unknown>>): Promise<boolean> {
    const opened = await open(ok, resource);
    if (opened === null || opened.table.primaryKey.length === 0) return false;
    const result = await runList({
      db: opened.db,
      view: opened.view,
      table: opened.table,
      params: { limit: 1, offset: 0, count: 'none' },
      canReadPii: false,
      dialect: opened.dialect,
      mandatory: combinePredicates(opened.predicate, byKey(opened.table, pk)) ?? undefined,
      exposeColumns: [...opened.table.primaryKey],
      searchColumns: [],
    });
    return result.data.length > 0;
  }

  /**
   * The keys of every row the session reads on a resource (or of the one row
   * `only` names), as the register spells them. Read in pages of the list's
   * own size; a claim reaching past {@link CLAIM_ROWS_MAX} rows is refused
   * rather than listed in part.
   */
  async function reachedKeys(
    ok: PublicAccess & { session: PublicSessionContext },
    resource: CompiledResource,
    only?: Readonly<Record<string, unknown>> | undefined,
  ): Promise<string[]> {
    const opened = await open(ok, resource);
    if (opened === null || opened.table.primaryKey.length === 0) return [];
    const keys: string[] = [];
    let cursor = '';
    for (;;) {
      const page = await runList({
        db: opened.db,
        view: opened.view,
        table: opened.table,
        params: { limit: LIST_LIMIT_MAX, cursor, count: 'none' },
        // The keys never leave the server: they only select register rows.
        canReadPii: true,
        dialect: opened.dialect,
        mandatory: (only === undefined ? opened.predicate : combinePredicates(opened.predicate, byKey(opened.table, only))) ?? undefined,
        exposeColumns: [...opened.table.primaryKey],
        searchColumns: [],
      });
      for (const row of page.data) {
        keys.push(entityKeyOf(Object.fromEntries(opened.table.primaryKey.map((column) => [column, row[column]]))));
      }
      if (keys.length > CLAIM_ROWS_MAX) throw new ClaimTooWideError();
      const next = page.cursor?.next ?? null;
      if (next === null) break;
      cursor = next;
    }
    return keys;
  }

  /** The register row, if this session may see it. Null is the 404 — for another's and for none alike. */
  async function visibleDocument(ok: PublicAccess, id: string): Promise<DocumentRow | null> {
    const session = ok.session;
    if (session === null) return null;
    const row = await documentsRepo(deps.meta).findById(id);
    if (row === null || row.status !== 'rendered') return null;
    if (row.connectionId !== ok.key.connectionId) return null;

    // Drawn from values: the claim and the key that asked for it.
    if (row.profileId === null) {
      const claim = row.claim;
      if (claim === null) return null;
      if (claim.column !== session.grant.column || String(claim.value) !== String(session.grant.value)) return null;
      // A claim from before keys were recorded was only ever made through an
      // operator's own key; an app's key never reads one.
      if (claim.keyId === undefined ? ok.key.managedBy !== null : claim.keyId !== ok.key.keyId) return null;
      return row;
    }

    const profile = await documentProfilesRepo(deps.meta).findById(row.profileId);
    // A document's connection is its profile's; the connection was asked above.
    if (profile === null || profile.ownerApp !== ok.key.managedBy) return null;
    if (row.entity === null || row.entityTable === null) return null;

    const declared = await declaredKinds(ok.key);
    const withSession = { key: ok.key, session };
    for (const resource of ok.key.scope.byRef.values()) {
      if (resource.table !== row.entityTable) continue;
      const kinds = declared.get(resource.ref);
      if (kinds === undefined || (kinds !== null && !kinds.has(row.kind))) continue;
      if (!personal(resource, session)) continue;
      if (await reaches(withSession, resource, row.entity.pk)) return row;
    }
    return null;
  }

  /**
   * One page of the session's documents, newest first, and the cursor of the
   * next page (null on the last).
   */
  async function listVisible(
    ok: PublicAccess,
    query: { ref?: string | undefined; id?: Readonly<Record<string, unknown>> | undefined; kind?: string | undefined; limit: number; after?: DocumentCursor | undefined },
  ): Promise<{ rows: DocumentRow[]; next: string | null }> {
    const session = ok.session;
    if (session === null) return { rows: [], next: null };
    const withSession = { key: ok.key, session };
    const declared = await declaredKinds(ok.key);
    const profiles = await ownProfiles(ok.key);
    const register = documentsRepo(deps.meta);

    // Per table: the rows reached, and the kinds some resource on it declares.
    const perTable = new Map<string, { keys: Set<string>; kinds: Set<string> | null }>();
    for (const resource of ok.key.scope.byRef.values()) {
      if (query.ref !== undefined && resource.ref !== query.ref) continue;
      const kinds = declared.get(resource.ref);
      if (kinds === undefined || !personal(resource, session)) continue;
      if (query.kind !== undefined && kinds !== null && !kinds.has(query.kind)) continue;
      const entry = perTable.get(resource.table) ?? { keys: new Set<string>(), kinds: new Set<string>() };
      entry.kinds = entry.kinds === null || kinds === null ? null : new Set([...entry.kinds, ...kinds]);
      for (const key of await reachedKeys(withSession, resource, query.id)) entry.keys.add(key);
      perTable.set(resource.table, entry);
    }

    const want = query.limit + 1;
    const found: DocumentRow[] = [];
    for (const [table, entry] of perTable) {
      const kinds = query.kind !== undefined ? [query.kind] : entry.kinds === null ? undefined : [...entry.kinds];
      const profileIds = profiles.filter((p) => p.table === table && (kinds === undefined || kinds.includes(p.kind))).map((p) => p.id);
      const keys = [...entry.keys];
      for (let at = 0; at < keys.length; at += IDS_CHUNK) {
        found.push(
          ...(await register.listForRows({
            connectionId: ok.key.connectionId,
            entityTable: table,
            entityIds: keys.slice(at, at + IDS_CHUNK),
            profileIds,
            kinds,
            after: query.after,
            limit: want,
          })),
        );
      }
    }

    // Documents drawn from values for this session's claim on this key —
    // an operator's key's door; never narrowed to a row.
    if (query.ref === undefined && query.id === undefined && ok.key.scope.documents.create) {
      let after = query.after;
      let matched = 0;
      for (;;) {
        const batch = await register.listClaimedIntents({ connectionId: ok.key.connectionId, after, limit: 200 });
        for (const row of batch) {
          const claim = row.claim;
          if (claim === null || claim.column !== session.grant.column || String(claim.value) !== String(session.grant.value)) continue;
          if (claim.keyId === undefined ? ok.key.managedBy !== null : claim.keyId !== ok.key.keyId) continue;
          if (query.kind !== undefined && row.kind !== query.kind) continue;
          found.push(row);
          matched += 1;
        }
        if (batch.length < 200 || matched >= want) break;
        const last = batch.at(-1)!;
        after = { createdAt: last.createdAt, id: last.id };
      }
    }

    found.sort(newer);
    const rows = found.slice(0, query.limit);
    const next = found.length > query.limit && rows.length > 0 ? encodeDocumentCursor(rows.at(-1)!) : null;
    return { rows, next };
  }

  /**
   * The profile a render on this resource draws with, or null (the 404): the
   * key's owner's, on the key's connection and the resource's table, enabled,
   * of a kind the resource declares.
   */
  async function profileForRender(key: ResolvedKey, resource: CompiledResource, body: { profileId?: string | undefined; kind?: string | undefined }): Promise<DocumentProfile | null> {
    const declared = (await declaredKinds(key)).get(resource.ref);
    if (declared === undefined) return null;
    const repo = documentProfilesRepo(deps.meta);
    let profile: DocumentProfile | null = null;
    if (body.profileId !== undefined) {
      profile = await repo.findById(body.profileId);
    } else if (body.kind !== undefined) {
      profile = (await ownProfiles(key)).find((p) => p.table === resource.table && p.kind === body.kind && p.enabled) ?? null;
    }
    if (profile === null || !profile.enabled) return null;
    if (profile.connectionId !== key.connectionId || profile.ownerApp !== key.managedBy || profile.table !== resource.table) return null;
    if (declared !== null && !declared.has(profile.kind)) return null;
    return profile;
  }

  return { declaredKinds, visibleDocument, listVisible, profileForRender, personal };
}

export type DocumentAccess = ReturnType<typeof createDocumentAccess>;
