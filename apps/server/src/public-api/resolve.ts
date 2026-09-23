// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Token → compiled scope.
 *
 * The hot path of the public surface. Everything expensive happens once:
 * `compileScope` runs on a cache miss, never per request, so the request path
 * receives a structure it can trust without re-deriving any authorization.
 *
 * ── EVERY FAILURE LOOKS THE SAME ───────────────────────────────────────────
 * Unknown prefix, wrong hash, revoked, expired, missing scope, scope that no
 * longer compiles — all return `null`. The caller answers one status with one
 * code. That is enumeration rule, and it is why this returns a bare `null`
 * rather than a discriminated reason: a reason is a thing a caller can
 * accidentally put on the wire, and the dashboard's own data routes already
 * demonstrate the failure mode (a 404 for an unknown connection and a 403 for a
 * real one, which together are a status-code oracle).
 *
 * The `onFailure` hook exists so the SERVER can still log what happened —
 * operators need to debug a key that stopped working — without that reason
 * having any route to the response.
 */

import { compileScope, type InheritedTenantConfig, ScopeCompileError, type CompiledScope, type TableColumnLookup } from './scope.js';
import {
  hashPublishableKey,
  keyIsLive,
  keyKindOf,
  tokenHashEquals,
  PUBLISHABLE_DISPLAY_PREFIX_LENGTH,
  type PublicKeyKind,
} from './keys.js';

export interface ResolvedKey {
  keyId: string;
  /** `browser` (`adm_pub_`) or `server` (`adm_srv_`), as the row says and the prefix agreed. */
  kind: PublicKeyKind;
  scopeId: string;
  connectionId: string;
  side: string;
  scope: CompiledScope;
  /** Per-key origin narrowing; empty means "no narrowing beyond the env list". */
  origins: readonly string[];
  /** The app that made this key at install, or null for an operator's own. */
  managedBy: string | null;
}

export interface PublicKeyRow {
  id: string;
  prefix: string;
  tokenHash: string;
  scopeId: string;
  side: string;
  origins: string;
  expiresAt: number | null;
  revokedAt: number | null;
  /** Absent on rows written before server keys existed: those are browser keys. */
  kind?: string;
  /** Absent on rows written before apps made their own keys. */
  managedBy?: string | null;
}

export interface PublicScopeRow {
  id: string;
  connectionId: string;
  timezone: string;
  document: string;
  /** The key a derived document was compiled for; null or absent when hand-written. */
  derivedForKey?: string | null;
}

export type ResolveFailure =
  | 'no-prefix-match'
  | 'hash-mismatch'
  | 'not-live'
  | 'scope-missing'
  | 'scope-uncompilable';

export interface ResolverDeps {
  findKeysByPrefix: (prefix: string) => Promise<PublicKeyRow[]>;
  findScopeById: (id: string) => Promise<PublicScopeRow | null>;
  /** Column existence per physical table, from the connection's snapshot. */
  columnsOf?: (connectionId: string) => Promise<TableColumnLookup | undefined>;
  /**
   * The connection's tenant configuration — the zone and currency a scope
   * inherits when it does not state its own. Optional so tests and the
   * Studio authoring path can compile a scope with no connection behind it.
   */
  tenantConfigOf?: (connectionId: string) => Promise<InheritedTenantConfig | undefined>;
  /** Server-side only. Never reaches a response. */
  onFailure?: (reason: ResolveFailure, detail: Record<string, unknown>) => void;
  ttlMs?: number;
  now?: () => number;
}

export interface PublicKeyResolver {
  resolve: (token: string) => Promise<ResolvedKey | null>;
  /** Called when a key or scope is written, so an edit takes effect at once. */
  invalidate: (keyId?: string) => void;
}

/**
 * Cache TTL.
 *
 * Longer than the off-switch gate's, because this is keyed on a SECRET the
 * caller must already possess — an attacker cannot make this cache do work for
 * them the way they can with an unauthenticated flag read. Short enough that a
 * revoked key stops working promptly even if something writes the row outside
 * the normal path.
 */
export const RESOLVER_TTL_MS = 30_000;

interface Entry {
  value: ResolvedKey;
  expiresAt: number;
}

/*
 * ── INVALIDATION RACES A FILL ──────────────────────────────────────────────
 * A miss awaits the meta store before it stores its result. If a revoke's
 * `invalidate()` runs during that wait, it finds nothing to delete, and the
 * fill then caches the key as live for a full TTL. So every fill records the
 * generation it started in, and stores its result only if no invalidation has
 * happened since. Invalidation also drops the shared in-flight lookups, so a
 * request arriving after a revoke starts a fresh one rather than joining a
 * lookup that began before it.
 */

export function createPublicKeyResolver(deps: ResolverDeps): PublicKeyResolver {
  const ttl = deps.ttlMs ?? RESOLVER_TTL_MS;
  const now = deps.now ?? Date.now;
  /* Keyed by the token HASH, never the token — a cache is a place secrets get read from. */
  const cache = new Map<string, Entry>();
  /*
   * One lookup per token hash at a time. Without it, a burst on a cold or
   * just-invalidated entry compiles the same scope once per concurrent request.
   */
  const inFlight = new Map<string, Promise<ResolvedKey | null>>();
  let generation = 0;

  const fail = (reason: ResolveFailure, detail: Record<string, unknown>): null => {
    deps.onFailure?.(reason, detail);
    return null;
  };

  const lookup = async (token: string, tokenHash: string, at: number): Promise<ResolvedKey | null> => {
    const started = generation;
    const prefix = token.slice(0, PUBLISHABLE_DISPLAY_PREFIX_LENGTH);
    const candidates = await deps.findKeysByPrefix(prefix);
    if (candidates.length === 0) return fail('no-prefix-match', { prefix });

    /*
     * Compare EVERY candidate rather than breaking on the first match. A
     * prefix collision is possible (8 base62 chars), and short-circuiting
     * would make the comparison count depend on which row matched — a timing
     * signal on top of the constant-time compare it would otherwise defeat.
     */
    let matched: PublicKeyRow | null = null;
    for (const row of candidates) {
      if (tokenHashEquals(row.tokenHash, tokenHash)) matched = row;
    }
    if (matched === null) return fail('hash-mismatch', { prefix });
    if (!keyIsLive(matched, at)) return fail('not-live', { keyId: matched.id });
    /*
     * The prefix decided at the gate whether this request needed an Origin;
     * the stored row must be the same kind, or a browser key re-spelled with
     * the server prefix would skip the origin check. The hash
     * covers the prefix, so this can only fail for a forged row.
     */
    const kind: PublicKeyKind = matched.kind === 'server' ? 'server' : 'browser';
    if (keyKindOf(token) !== kind) return fail('hash-mismatch', { prefix });

    const scopeRow = await deps.findScopeById(matched.scopeId);
    if (scopeRow === null) return fail('scope-missing', { keyId: matched.id, scopeId: matched.scopeId });

    let scope: CompiledScope;
    try {
      const columnsOf = await deps.columnsOf?.(scopeRow.connectionId);
      // The connection carries the tenant's zone and currency; the scope
      // overrides them when it states its own.
      const inherited = await deps.tenantConfigOf?.(scopeRow.connectionId);
      scope = compileScope(
        JSON.parse(scopeRow.document) as unknown,
        columnsOf,
        inherited,
        // A derived document may hold no resources.
        { derived: (scopeRow.derivedForKey ?? null) !== null },
      );
    } catch (error) {
      /*
       * A stored scope that no longer compiles means the schema moved under
       * it — a column was dropped, a table renamed. The surface goes DARK for
       * that key rather than serving whatever still resolves, because a
       * partially-valid authorization document is not a narrower one; it is an
       * unreviewed one.
       */
      return fail('scope-uncompilable', {
        keyId: matched.id,
        scopeId: scopeRow.id,
        issues: error instanceof ScopeCompileError ? error.issues.map((i) => i.code) : [String(error)],
      });
    }

    let origins: readonly string[] = [];
    try {
      const parsed: unknown = JSON.parse(matched.origins);
      if (Array.isArray(parsed)) origins = parsed.filter((o): o is string => typeof o === 'string');
    } catch {
      // A malformed origins column narrows to nothing rather than to
      // everything: the env allow-list still applies, and the key is simply
      // not narrowed further.
      origins = [];
    }

    const resolved: ResolvedKey = {
      keyId: matched.id,
      kind,
      scopeId: scopeRow.id,
      connectionId: scopeRow.connectionId,
      side: matched.side,
      scope,
      origins,
      managedBy: matched.managedBy ?? null,
    };
    if (started === generation) {
      // Never cached past the key's own expiry: a key must stop at
      // `expires_at`, not up to a TTL later.
      const expiresAt = Math.min(at + ttl, matched.expiresAt ?? Number.POSITIVE_INFINITY);
      cache.set(tokenHash, { value: resolved, expiresAt });
    }
    return resolved;
  };

  return {
    async resolve(token) {
      const at = now();
      const tokenHash = hashPublishableKey(token);

      const cached = cache.get(tokenHash);
      if (cached !== undefined && cached.expiresAt > at) return cached.value;

      const pending = inFlight.get(tokenHash);
      if (pending !== undefined) return pending;
      const fill = lookup(token, tokenHash, at).finally(() => {
        // Only our own entry: an invalidation may have replaced it already.
        if (inFlight.get(tokenHash) === fill) inFlight.delete(tokenHash);
      });
      inFlight.set(tokenHash, fill);
      return fill;
    },

    invalidate(keyId) {
      generation += 1;
      inFlight.clear();
      if (keyId === undefined) {
        cache.clear();
        return;
      }
      for (const [hash, entry] of cache) {
        if (entry.value.keyId === keyId) cache.delete(hash);
      }
    },
  };
}
