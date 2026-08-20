// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Token → compiled scope (28-public-surface.md §3.2–§3.3).
 *
 * The hot path of the public surface. Everything expensive happens once:
 * `compileScope` runs on a cache miss, never per request, so the request path
 * receives a structure it can trust without re-deriving any authorization.
 *
 * ── EVERY FAILURE LOOKS THE SAME ───────────────────────────────────────────
 * Unknown prefix, wrong hash, revoked, expired, missing scope, scope that no
 * longer compiles — all return `null`. The caller answers one status with one
 * code. That is §3.2's enumeration rule, and it is why this returns a bare
 * `null` rather than a discriminated reason: a reason is a thing a caller can
 * accidentally put on the wire, and the dashboard's own data routes already
 * demonstrate the failure mode (a 404 for an unknown connection and a 403 for a
 * real one, which together are a status-code oracle).
 *
 * The `onFailure` hook exists so the SERVER can still log what happened —
 * operators need to debug a key that stopped working — without that reason
 * having any route to the response.
 */

import { compileScope, ScopeCompileError, type CompiledScope, type TableColumnLookup } from './scope.js';
import { hashPublishableKey, keyIsLive, tokenHashEquals, PUBLISHABLE_DISPLAY_PREFIX_LENGTH } from './keys.js';

export interface ResolvedKey {
  keyId: string;
  scopeId: string;
  connectionId: string;
  side: string;
  scope: CompiledScope;
  /** Per-key origin narrowing; empty means "no narrowing beyond the env list". */
  origins: readonly string[];
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
}

export interface PublicScopeRow {
  id: string;
  connectionId: string;
  timezone: string;
  document: string;
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

export function createPublicKeyResolver(deps: ResolverDeps): PublicKeyResolver {
  const ttl = deps.ttlMs ?? RESOLVER_TTL_MS;
  const now = deps.now ?? Date.now;
  /* Keyed by the token HASH, never the token — a cache is a place secrets get read from. */
  const cache = new Map<string, Entry>();

  const fail = (reason: ResolveFailure, detail: Record<string, unknown>): null => {
    deps.onFailure?.(reason, detail);
    return null;
  };

  return {
    async resolve(token) {
      const at = now();
      const tokenHash = hashPublishableKey(token);

      const cached = cache.get(tokenHash);
      if (cached !== undefined && cached.expiresAt > at) return cached.value;

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

      const scopeRow = await deps.findScopeById(matched.scopeId);
      if (scopeRow === null) return fail('scope-missing', { keyId: matched.id, scopeId: matched.scopeId });

      let scope: CompiledScope;
      try {
        const columnsOf = await deps.columnsOf?.(scopeRow.connectionId);
        scope = compileScope(JSON.parse(scopeRow.document) as unknown, columnsOf);
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
        scopeId: scopeRow.id,
        connectionId: scopeRow.connectionId,
        side: matched.side,
        scope,
        origins,
      };
      cache.set(tokenHash, { value: resolved, expiresAt: at + ttl });
      return resolved;
    },

    invalidate(keyId) {
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
