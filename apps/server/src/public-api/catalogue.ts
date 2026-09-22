// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The API catalogue: what `/api-docs` lists.
 *
 * ── ONLY WHAT IS CALLABLE ──────────────────────────────────────────────────
 * The page lists STORED endpoints that at least one live key grants, with the
 * methods those keys were granted — never the definition's ceiling, and never
 * a virtual default. So switching the page on publishes nothing that a key
 * does not already let someone call, and a connection no key touches is not
 * on the page at all. One answer for every visitor: no
 * session branch.
 *
 * ── WHAT IS NEVER IN IT ────────────────────────────────────────────────────
 * No physical table name, no filters (an authorization rule is never
 * published — the scope compiler's own argument), no row counts, no key.
 * Columns are the `select` list with their LOGICAL types.
 *
 * ── COST ───────────────────────────────────────────────────────────────────
 * Anyone can ask, so the answer is memoized per process for at most 30 s, one
 * build at a time, and dropped whenever an admin write moves what keys may do.
 * A connection whose schema cannot be read is left out rather than turning the
 * whole page into a 500.
 */

import { publicEndpointsRepo, publicKeysRepo, type MetaDb } from '@adminium/meta';

import type { SnapshotView } from '../crud/identifiers.js';
import { parseAccess } from './derive.js';
import {
  canonicalMethods,
  definitionToResource,
  parseDefinition,
  sourceTable,
  type PublicAuthRole,
  type PublicMethod,
  type RateWindow,
} from './endpoint.js';

export type CatalogueColumnTag = 'pk' | 'unique' | 'fk';

export interface CatalogueColumn {
  name: string;
  /** The logical type (`uuid`, `integer`, `timestamp`, …) — never the native one. */
  type: string;
  tags: CatalogueColumnTag[];
}

export interface CatalogueEndpoint {
  ref: string;
  path: string;
  /** The source's own label, or null. */
  singular: string | null;
  methods: PublicMethod[];
  auth: PublicAuthRole;
  limit: number;
  maxLimit: number;
  order: string;
  rate: { requests: number; window: RateWindow };
  response: 'wrapped' | 'array' | 'single';
  columns: CatalogueColumn[];
  /** What a write may carry; empty when no write is granted. */
  writable: string[];
}

export interface CatalogueConnection {
  /** Null unless two or more connections have listed endpoints. */
  label: string | null;
  endpoints: CatalogueEndpoint[];
}

export interface CatalogueSource {
  listConnections: () => Promise<{ id: string; name: string }[]>;
  listEndpoints: (connectionId: string) => Promise<{ id: string; ref: string; definition: string }[]>;
  /** Every LIVE key of the connection, with its `access` text. */
  listLiveKeys: (connectionId: string) => Promise<{ access: string | null }[]>;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
}

const WRITE_METHODS: ReadonlySet<PublicMethod> = new Set(['POST', 'PATCH', 'PUT', 'BATCH']);

/** One connection's listed endpoints. Throws when its schema cannot be read. */
async function connectionEndpoints(source: CatalogueSource, connectionId: string): Promise<CatalogueEndpoint[]> {
  const stored = await source.listEndpoints(connectionId);
  if (stored.length === 0) return [];
  const granted = new Map<string, Set<PublicMethod>>();
  for (const key of await source.listLiveKeys(connectionId)) {
    for (const [endpointId, methods] of Object.entries(parseAccess(key.access))) {
      const set = granted.get(endpointId) ?? new Set<PublicMethod>();
      for (const m of methods) set.add(m);
      granted.set(endpointId, set);
    }
  }
  if (granted.size === 0) return [];

  const view = await source.viewFor(connectionId);
  if (view === null) return [];

  const out: CatalogueEndpoint[] = [];
  for (const row of stored) {
    const grant = granted.get(row.id);
    if (grant === undefined) continue;
    const parsed = parseDefinition(row.definition);
    if (!parsed.ok) continue;
    const def = parsed.definition;
    const offered = new Set(def.methods);
    const methods = canonicalMethods([...grant].filter((m) => offered.has(m)));
    if (methods.length === 0) continue;
    // A source that has gone answers every request with the 404; listing it
    // would document an endpoint nobody can call.
    const table = sourceTable(view, def.source);
    if (table === null) continue;

    const fks = new Set<string>();
    for (const relation of view.model.relations) {
      if (relation.through !== null || relation.from.tableId !== table.id) continue;
      for (const column of relation.from.columns) fks.add(column);
    }
    const columns: CatalogueColumn[] = [];
    for (const name of def.select) {
      const column = table.table.columns.find((c) => c.name === name);
      // A secret column is invisible everywhere, and a column that has gone is
      // not one a response can carry.
      if (column === undefined || table.columns.get(name) === undefined) continue;
      const tags: CatalogueColumnTag[] = [];
      if (column.isPrimaryKey) tags.push('pk');
      if (column.isUnique && !column.isPrimaryKey) tags.push('unique');
      if (fks.has(name)) tags.push('fk');
      columns.push({ name, type: column.logicalType, tags });
    }

    const writes = methods.some((m) => WRITE_METHODS.has(m));
    out.push({
      ref: row.ref,
      path: `/${row.ref}`,
      singular: table.table.label ?? null,
      methods,
      auth: def.auth.role,
      limit: def.pagination.default_limit,
      maxLimit: def.pagination.max_limit,
      order: def.pagination.order,
      rate: { requests: def.rate_limit.requests, window: def.rate_limit.window },
      response: def.response.shape === 'object' ? 'wrapped' : def.response.shape,
      columns,
      writable: writes ? definitionToResource(row.ref, def, methods, table).writable : [],
    });
  }
  return out.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/** Every connection's listed endpoints; a connection that fails is skipped. */
export async function buildCatalogue(
  source: CatalogueSource,
  onError?: (connectionId: string, error: unknown) => void,
): Promise<CatalogueConnection[]> {
  const listed: { name: string; endpoints: CatalogueEndpoint[] }[] = [];
  for (const connection of await source.listConnections()) {
    try {
      const endpoints = await connectionEndpoints(source, connection.id);
      if (endpoints.length > 0) listed.push({ name: connection.name, endpoints });
    } catch (error) {
      onError?.(connection.id, error);
    }
  }
  // A connection's name is internal. With one connection it adds nothing a
  // visitor needs, so it is published only when it tells two groups apart.
  const named = listed.length > 1;
  return listed.map((c) => ({ label: named ? c.name : null, endpoints: c.endpoints }));
}

export const CATALOGUE_TTL_MS = 30_000;

export interface ApiCatalogue {
  read: () => Promise<CatalogueConnection[]>;
  /** An admin write moved what keys may call. */
  invalidate: () => void;
}

/** {@link buildCatalogue}, memoized: one build at a time, at most `ttlMs` old. */
export function createApiCatalogue(
  source: CatalogueSource,
  opts: { ttlMs?: number; now?: () => number; onError?: (connectionId: string, error: unknown) => void } = {},
): ApiCatalogue {
  const ttl = opts.ttlMs ?? CATALOGUE_TTL_MS;
  const now = opts.now ?? Date.now;
  let value: CatalogueConnection[] | null = null;
  let expiresAt = 0;
  let inFlight: Promise<CatalogueConnection[]> | null = null;
  // A build that started before `invalidate()` read the old grants; it may
  // answer the requests that joined it, but it is never stored.
  let generation = 0;

  const build = async (started: number): Promise<CatalogueConnection[]> => {
    try {
      const next = await buildCatalogue(source, opts.onError);
      if (started === generation) {
        value = next;
        expiresAt = now() + ttl;
      }
      return next;
    } finally {
      if (started === generation) inFlight = null;
    }
  };

  return {
    async read() {
      if (value !== null && now() < expiresAt) return value;
      inFlight ??= build(generation);
      return inFlight;
    },
    invalidate() {
      generation += 1;
      value = null;
      expiresAt = 0;
      inFlight = null;
    },
  };
}

/** The meta-store reads {@link buildCatalogue} needs. */
export function metaCatalogueSource(
  meta: MetaDb,
  viewFor: (connectionId: string) => Promise<SnapshotView | null>,
): CatalogueSource {
  const endpoints = publicEndpointsRepo(meta);
  const keys = publicKeysRepo(meta);
  return {
    listConnections: () =>
      meta.db.selectFrom('adminium_connections').select(['id', 'name']).orderBy('name').orderBy('id').execute(),
    listEndpoints: async (connectionId) =>
      (await endpoints.listByConnection(connectionId)).map((e) => ({ id: e.id, ref: e.ref, definition: e.definition })),
    listLiveKeys: (connectionId) => keys.listLiveDerived(connectionId),
    viewFor,
  };
}
