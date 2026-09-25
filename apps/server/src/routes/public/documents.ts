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
import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { appDocumentOff } from '../../documents/app-documents.js';
import { outboundKey } from '../../documents/compose.js';
import { STATEMENT_PERIODS, type StatementSources } from '../../documents/statement.js';
import type { ProfileMapping } from '../../documents/subject.js';
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

/**
 * How many documents drawn from values one list request reads, at most, to
 * find a session's own: they are matched by a claim kept as JSON, so each is
 * read to be compared. Past this the list stops and says what it found.
 */
export const INTENT_SCAN_MAX = 1_000;
const INTENT_PAGE = 200;

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
    // A time a column can hold: a whole, non-negative, safe number.
    if (Array.isArray(parsed) && Number.isSafeInteger(parsed[0]) && (parsed[0] as number) >= 0 && typeof parsed[1] === 'string' && parsed[1].length <= 40) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

/** A value the key column's type can hold, or null: never a query the database refuses. */
function keyValue(value: unknown, logicalType: string): unknown {
  if (logicalType === 'integer' || logicalType === 'bigint') {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (!/^-?\d{1,16}$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (logicalType === 'uuid') {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  return typeof value === 'string' && value.length <= 200 ? value : null;
}

/**
 * A row's key from what a caller sent — one value, or a JSON object or list
 * for a key of several columns — each part checked against its column's type.
 * Null when it cannot be one: a text on a number key, a number too large to
 * hold. The caller answers that exactly as an unknown row, on every engine,
 * rather than letting the database refuse it with an error of its own.
 */
export function recordKeyOf(table: ResolvedTable, raw: unknown): Record<string, unknown> | null {
  const columns = table.primaryKey;
  if (columns.length === 0) return null;
  let parts: Record<string, unknown>;
  if (columns.length === 1) {
    parts = { [columns[0]!]: raw };
  } else {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
    if (Array.isArray(parsed) && parsed.length === columns.length) parts = Object.fromEntries(columns.map((c, i) => [c, parsed[i]]));
    else if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) parts = parsed as Record<string, unknown>;
    else return null;
  }
  const out: Record<string, unknown> = {};
  for (const column of columns) {
    const value = keyValue(parts[column], table.columns.get(column)?.logicalType ?? 'text');
    if (value === null) return null;
    out[column] = value;
  }
  return out;
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
  /**
   * The add-on runtime, so an app's key draws only while the add-on is
   * attached to the app and its feature on. Absent: not asked.
   */
  runtime?: (() => AddOnRuntimeState | null) | undefined;
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

  /** Whether a session may read this resource's rows at all: readable, reached, at its level. */
  function readable(resource: CompiledResource, session: PublicSessionContext): boolean {
    if (resource.kind !== 'records' || !resource.actions.has('read')) return false;
    if (!claimPredicateFor(resource, session).reachable) return false;
    return resource.level !== 'verified' || session.level === 'verified';
  }

  /**
   * What this session may read of the tables a document reads beside its
   * own row and its lines: a statement's documents and payments, and the rows
   * its linked slots read (a client's company).
   *
   * A table this key serves at all is held to the key: the session must read
   * it through one of its resources — reached, at the level it asks — and
   * only the rows those resources show are read (their filters and claims,
   * ORed). Short of the level it is `level` (the same answer a record read
   * gives); with no resource that opens it, `none` (the 404). A statement's
   * sources must be served by the key. A linked table the key does not serve
   * at all is part of the document as its author mapped it, read whole — as
   * its lines are.
   */
  async function sourceAccess(
    ok: PublicAccess & { session: PublicSessionContext },
    profile: DocumentProfile,
  ): Promise<{ state: 'ok'; filters: Map<string, RecordFilter | null> } | { state: 'level' | 'none' }> {
    const view = await deps.viewFor(ok.key.connectionId);
    if (view === null) return { state: 'none' };
    const needed = new Map<string, 'statement' | 'linked'>();
    const statement = (profile.options as { statement?: StatementSources }).statement;
    if (statement !== undefined) {
      needed.set(statement.documents.table, 'statement');
      needed.set(statement.payments.table, 'statement');
    }
    let base: ResolvedTable | null = null;
    try {
      base = view.table(profile.table);
    } catch {
      return { state: 'none' };
    }
    for (const mapped of Object.values(profile.mapping as ProfileMapping)) {
      if (!('ref' in mapped)) continue;
      const target = mapped.table ?? outboundKey(view, base, mapped.ref)?.tableId;
      if (target !== undefined && !needed.has(target)) needed.set(target, 'linked');
    }

    const filters = new Map<string, RecordFilter | null>();
    for (const [tableId, why] of needed) {
      const serving = [...ok.key.scope.byRef.values()].filter((r) => r.table === tableId && r.kind === 'records' && r.actions.has('read'));
      if (serving.length === 0) {
        if (why === 'statement') return { state: 'none' };
        continue;
      }
      const open = serving.filter((r) => readable(r, ok.session));
      if (open.length === 0) {
        const short = serving.some((r) => claimPredicateFor(r, ok.session).reachable && r.level === 'verified');
        return { state: short ? 'level' : 'none' };
      }
      let table: ResolvedTable;
      try {
        table = view.table(tableId);
      } catch {
        return { state: 'none' };
      }
      const predicates: (RecordFilter | null)[] = open.map((r) => {
        const claim = claimPredicateFor(r, ok.session);
        return combinePredicates(mandatoryAt(r.where, table, ok.key.scope.timezone), claim.reachable ? claim.predicate : null);
      });
      filters.set(tableId, predicates.some((p) => p === null) ? null : predicates.length === 1 ? predicates[0]! : { or: predicates as RecordFilter[] });
    }
    return { state: 'ok', filters };
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
    if (row.profileId === null) return intentIsOwn(ok.key, session, row) ? row : null;

    const profile = await documentProfilesRepo(deps.meta).findById(row.profileId);
    // A document's connection is its profile's; the connection was asked above.
    if (profile === null || profile.ownerApp !== ok.key.managedBy) return null;
    if (row.entity === null || row.entityTable === null) return null;

    const declared = await declaredKinds(ok.key);
    const withSession = { key: ok.key, session };
    // What it was drawn from beside its row, this session must be able to read.
    if ((await sourceAccess(withSession, profile)).state !== 'ok') return null;
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
   * Whether a document drawn from values is this session's own: the key's
   * documents door is open, the claim is this session's (column, value and
   * the identity it was made through, when recorded), and it was asked for
   * through this key — or, for a claim from before keys were recorded, through
   * an operator's own key, the only kind that could ask then.
   */
  function intentIsOwn(key: ResolvedKey, session: PublicSessionContext, row: DocumentRow): boolean {
    const claim = row.claim;
    if (claim === null || !key.scope.documents.create) return false;
    if (claim.column !== session.grant.column || String(claim.value) !== String(session.grant.value)) return false;
    if (claim.ref !== undefined && claim.ref !== session.grant.ref) return false;
    return claim.keyId === undefined ? key.managedBy === null : claim.keyId === key.keyId;
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

    /*
     * PER RESOURCE, never per table: each resource lists the documents of the
     * kinds IT declares for the rows IT reaches. Two resources on one table
     * (a client's own invoices, and the invoices they referred) must not
     * cross — the referred row's invoice is not the referrer's to see just
     * because some resource declares invoices.
     */
    const want = query.limit + 1;
    const found = new Map<string, DocumentRow>();
    const readableProfiles = new Map<string, boolean>();
    const mayRead = async (profile: DocumentProfile): Promise<boolean> => {
      let known = readableProfiles.get(profile.id);
      if (known === undefined) {
        known = (await sourceAccess(withSession, profile)).state === 'ok';
        readableProfiles.set(profile.id, known);
      }
      return known;
    };
    for (const resource of ok.key.scope.byRef.values()) {
      if (query.ref !== undefined && resource.ref !== query.ref) continue;
      const declaredHere = declared.get(resource.ref);
      if (declaredHere === undefined || !personal(resource, session)) continue;
      if (query.kind !== undefined && declaredHere !== null && !declaredHere.has(query.kind)) continue;
      const kinds = query.kind !== undefined ? [query.kind] : declaredHere === null ? undefined : [...declaredHere];
      const candidates = profiles.filter((p) => p.table === resource.table && (kinds === undefined || kinds.includes(p.kind)));
      const profileIds: string[] = [];
      for (const profile of candidates) if (await mayRead(profile)) profileIds.push(profile.id);
      if (profileIds.length === 0) continue;
      const keys = await reachedKeys(withSession, resource, query.id);
      for (let at = 0; at < keys.length; at += IDS_CHUNK) {
        const rows = await register.listForRows({
          connectionId: ok.key.connectionId,
          entityTable: resource.table,
          entityIds: keys.slice(at, at + IDS_CHUNK),
          profileIds,
          kinds,
          after: query.after,
          limit: want,
        });
        for (const row of rows) found.set(row.id, row);
      }
    }

    /*
     * Documents drawn from values for this session's claim on this key — an
     * operator's key's door; never narrowed to a row. Their claim is JSON, so
     * each is read to be compared: at most INTENT_SCAN_MAX of them per request.
     */
    if (query.ref === undefined && query.id === undefined && ok.key.scope.documents.create) {
      let after = query.after;
      let matched = 0;
      for (let scanned = 0; scanned < INTENT_SCAN_MAX; ) {
        const batch = await register.listClaimedIntents({ connectionId: ok.key.connectionId, after, limit: INTENT_PAGE });
        scanned += batch.length;
        for (const row of batch) {
          if (!intentIsOwn(ok.key, session, row)) continue;
          if (query.kind !== undefined && row.kind !== query.kind) continue;
          found.set(row.id, row);
          matched += 1;
        }
        if (batch.length < INTENT_PAGE || matched >= want) break;
        const last = batch.at(-1)!;
        after = { createdAt: last.createdAt, id: last.id };
      }
    }

    const sorted = [...found.values()].sort(newer);
    const rows = sorted.slice(0, query.limit);
    const next = sorted.length > query.limit && rows.length > 0 ? encodeDocumentCursor(rows.at(-1)!) : null;
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
    // An app's document is drawn only while its add-on — and its feature — is on.
    if (key.managedBy !== null && deps.runtime !== undefined) {
      const installed = await manifestsRepo(deps.meta, NO_SECRETS).findByKey(key.managedBy);
      const manifest = installed?.document as AppManifest | undefined;
      if (manifest?.kind !== 'app') return null;
      const names = await appTablesRepo(deps.meta).realNames(key.connectionId, key.managedBy);
      const table = (await deps.viewFor(key.connectionId))?.model.tables.find((t) => t.id === profile.table)?.name;
      const ref = Object.entries(names).find(([, real]) => real === table)?.[0] ?? '';
      if ((await appDocumentOff({ meta: deps.meta, manifest, profile, table: ref, runtime: deps.runtime })) !== null) return null;
    }
    return profile;
  }

  return { declaredKinds, visibleDocument, listVisible, profileForRender, personal, sourceAccess };
}

export type DocumentAccess = ReturnType<typeof createDocumentAccess>;
