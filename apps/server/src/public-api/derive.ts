// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DERIVED scope documents: the scope a key made from endpoint grants runs on.
 * Pure — `endpoint-service.ts` does the reading, the
 * compare-and-set and the writing.
 *
 * ── THE RUNTIME DOES NOT CHANGE ────────────────────────────────────────────
 * A key made the new way still points at a scope row, and that row holds an
 * ordinary scope document — one this file writes from the key's grants
 * instead of one an operator typed. So the resolver, `compileScope`,
 * `/public/config`, the hosted surfaces' key lookup and the DDL preflight all
 * read what they always read. "Adminium writes the scope for you" is literal.
 *
 * A key's `access` is never rewritten by an endpoint save. A method
 * the endpoint no longer offers is SUSPENDED — dropped from the document, kept
 * in the grant — and comes back if the endpoint offers it again.
 */

import type { PublicEndpoint } from '@adminium/meta';

import type { SnapshotView } from '../crud/identifiers.js';
import {
  canonicalMethods,
  parseDefinition,
  PUBLIC_METHODS,
  sourceTable,
  definitionToResource,
  type PublicEndpointDefinition,
  type PublicMethod,
} from './endpoint.js';
import {
  compileScope,
  ScopeCompileError,
  type InheritedTenantConfig,
  type PublicScopeDocument,
  type PublicScopeResource,
  type ScopeIssue,
} from './scope.js';

/* -------------------------------------------------------------- derivation */

export type PublicKeyKind = 'browser' | 'server';

/** A key's grant: `{ endpointId: methods }`. */
export type AccessMap = Readonly<Record<string, readonly PublicMethod[]>>;

export interface DeriveKey {
  kind: PublicKeyKind;
  access: AccessMap;
}

export interface DeriveEndpoint {
  id: string;
  ref: string;
  definition: PublicEndpointDefinition;
}

/** A granted method the endpoint does not (or no longer) offer, or an endpoint that is gone. */
export interface SuspendedGrant {
  endpointId: string;
  /** Null when the endpoint no longer exists. */
  ref: string | null;
  methods: PublicMethod[];
}

export interface Derivation {
  document: PublicScopeDocument;
  /** Problems with the KEY's combination of grants, beyond any one endpoint. */
  issues: ScopeIssue[];
  suspended: SuspendedGrant[];
}

/** Parse a stored `access` column. Anything unreadable is an empty grant. */
export function parseAccess(text: string | null): Record<string, PublicMethod[]> {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: Record<string, PublicMethod[]> = {};
    for (const [id, methods] of Object.entries(value as Record<string, unknown>)) {
      if (!Array.isArray(methods)) continue;
      out[id] = canonicalMethods(methods.filter((m): m is PublicMethod => (PUBLIC_METHODS as readonly string[]).includes(m as string)));
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The scope document a key's grants add up to.
 *
 * `side` follows the key's KIND and nothing else: a server key is
 * staff-side, a browser key customer-side. So a save can never flip a key's
 * side under the `adminium_public_keys.side` column the hosted surfaces
 * filter on.
 *
 * Time zone and currency are left out on purpose: they inherit from the
 * connection, so changing a business's zone is one edit.
 */
export function deriveScopeDocument(
  key: DeriveKey,
  endpointsById: ReadonlyMap<string, DeriveEndpoint>,
  view: SnapshotView | null,
): Derivation {
  const issues: ScopeIssue[] = [];
  const suspended: SuspendedGrant[] = [];
  const resources: PublicScopeResource[] = [];
  const identities: { ref: string; definition: PublicEndpointDefinition; methods: PublicMethod[] }[] = [];

  for (const [endpointId, granted] of Object.entries(key.access)) {
    const endpoint = endpointsById.get(endpointId);
    if (endpoint === undefined) {
      if (granted.length > 0) suspended.push({ endpointId, ref: null, methods: canonicalMethods(granted) });
      continue;
    }
    const offered = new Set(endpoint.definition.methods);
    const effective = canonicalMethods(granted.filter((m) => offered.has(m)));
    const lost = canonicalMethods(granted.filter((m) => !offered.has(m)));
    if (lost.length > 0) suspended.push({ endpointId, ref: endpoint.ref, methods: lost });
    // A grant narrowed to nothing contributes no resource at all.
    if (effective.length === 0) continue;

    if (endpoint.definition.auth.role === 'service_role' && key.kind === 'browser') {
      issues.push({
        code: 'KEY_SERVICE_ROLE_BROWSER',
        message: `"${endpoint.ref}" is a service-role endpoint, which only a server key may be granted`,
        ref: endpoint.ref,
      });
      // Left out of the document as well as reported: a browser key never
      // carries a staff resource, even in a document stored while broken.
      continue;
    }
    if (endpoint.definition.identity !== undefined) {
      identities.push({ ref: endpoint.ref, definition: endpoint.definition, methods: effective });
    }
    const table = view === null ? null : sourceTable(view, endpoint.definition.source);
    resources.push(definitionToResource(endpoint.ref, endpoint.definition, effective, table));
  }

  const document: PublicScopeDocument = {
    version: 1,
    side: key.kind === 'server' ? 'staff' : 'customer',
    resources: resources.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
  };

  /*
   * The document-level claim comes from the ONE granted endpoint that carries
   * an identity. Two would be two ways to be somebody, and the claim
   * route could only honour one of them.
   */
  if (identities.length > 1) {
    issues.push({
      code: 'KEY_IDENTITY_AMBIGUOUS',
      message: `this key is granted ${identities.length} identity endpoints (${identities.map((i) => i.ref).join(', ')}); grant one`,
    });
  } else if (identities.length === 1) {
    const identity = identities[0] as (typeof identities)[number];
    const spec = identity.definition.identity;
    if (spec !== undefined) {
      if (!identity.methods.includes('GET')) {
        issues.push({
          code: 'KEY_IDENTITY_NEEDS_GET',
          message: `a claim is resolved by reading "${identity.ref}", so the key needs GET on it`,
          ref: identity.ref,
        });
      }
      document.claim = {
        strategy: spec.strategy,
        ref: identity.ref,
        match: [...spec.match],
        ...(spec.verify === undefined ? {} : { verify: spec.verify }),
        ...(spec.email === undefined ? {} : { email: spec.email }),
        // Every claim through this identity is proved to be a person's.
        ...(identity.definition.human_check === undefined ? {} : { humanCheck: true as const }),
      };
    }
  }
  if (identities.length === 0 && resources.some((r) => r.claim !== undefined)) {
    const gated = resources.filter((r) => r.claim !== undefined).map((r) => r.ref);
    issues.push({
      code: 'KEY_IDENTITY_MISSING',
      message: `${gated.join(', ')} need a signed-in customer, and this key is granted no identity endpoint to sign in with`,
    });
  }

  return { document, issues, suspended };
}

/** Column existence exactly as the resolver sees it, so a save and a request agree. */
function lookupOf(view: SnapshotView | null): ((table: string) => ReadonlySet<string> | null) | undefined {
  if (view === null) return undefined;
  return (table) => {
    const resolved = sourceTable(view, table);
    return resolved === null ? null : new Set(resolved.columns.keys());
  };
}

/** Every issue a derived document raises against the current schema, never thrown. */
export function derivedDocumentIssues(
  document: unknown,
  view: SnapshotView | null,
  inherited: InheritedTenantConfig | undefined,
): ScopeIssue[] {
  try {
    compileScope(document, lookupOf(view), inherited, { derived: true });
    return [];
  } catch (error) {
    if (error instanceof ScopeCompileError) return [...error.issues];
    throw error;
  }
}

const issueKey = (i: ScopeIssue): string => `${i.code}|${i.ref ?? ''}|${i.column ?? ''}`;

/** The issues in `after` that `before` did not have, by code + ref + column. */
export function introducedIssues(before: readonly ScopeIssue[], after: readonly ScopeIssue[]): ScopeIssue[] {
  const seen = new Set(before.map(issueKey));
  return after.filter((i) => !seen.has(issueKey(i)));
}

/** What a key would gain from a save, per ref — the warning before Save. */
export interface Widening {
  ref: string;
  methods: string[];
  columns: string[];
  /**
   * True when the save removes or changes a mandatory filter — or loosens
   * what a caller may write: a value it may set, the state a row must be in
   * before it changes, or the limits on a stranger's create.
   */
  rows: boolean;
}

/** Each limit on a write as one comparable string: `values|status|["cancelled"]`. */
function writeLimits(r: PublicScopeResource | undefined): Set<string> {
  const out = new Set<string>();
  for (const [column, values] of Object.entries(r?.writableValues ?? {})) out.add(`values|${column}|${JSON.stringify(values)}`);
  for (const [column, when] of Object.entries(r?.writableWhen ?? {})) out.add(`when|${column}|${JSON.stringify(when)}`);
  return out;
}

/**
 * Whether a save loosens the limits on a create nobody signed in for: a cap
 * dropped or raised, a column no longer counted or no longer held to plain
 * text. A tighter cap is not a widening.
 */
function capsLoosened(before: PublicScopeResource['anonymous'], after: PublicScopeResource['anonymous']): boolean {
  if (before === undefined) return false;
  if (after === undefined) return true;
  if (before.perKeyHour !== undefined && (after.perKeyHour === undefined || after.perKeyHour > before.perKeyHour)) return true;
  const was = before.perValue;
  const now = after.perValue;
  if (was !== undefined && (now === undefined || now.n > was.n || was.columns.some((column) => !now.columns.includes(column)))) return true;
  return (before.plainText ?? []).some((column) => !(after.plainText ?? []).includes(column));
}

export function wideningOf(before: unknown, after: PublicScopeDocument): Widening[] {
  const old = new Map<string, PublicScopeResource>();
  if (typeof before === 'object' && before !== null && Array.isArray((before as { resources?: unknown }).resources)) {
    for (const r of (before as { resources: PublicScopeResource[] }).resources) old.set(r.ref, r);
  }
  const out: Widening[] = [];
  for (const r of after.resources) {
    const prior = old.get(r.ref);
    const had = new Set(prior?.actions ?? []);
    const shown = new Set(prior?.expose ?? []);
    const oldWhere = new Set((prior?.where ?? []).map((w) => JSON.stringify(w)));
    const newWhere = new Set(r.where.map((w) => JSON.stringify(w)));
    const methods = r.actions.filter((a) => !had.has(a));
    const columns = r.expose.filter((c) => !shown.has(c));
    // Rows widen when a condition that held before no longer does — on reads, or on writes.
    const limits = writeLimits(r);
    const rows =
      prior !== undefined &&
      ([...oldWhere].some((w) => !newWhere.has(w)) || [...writeLimits(prior)].some((l) => !limits.has(l)) || capsLoosened(prior.anonymous, r.anonymous));
    if (methods.length > 0 || columns.length > 0 || rows) out.push({ ref: r.ref, methods, columns, rows });
  }
  return out;
}

/** Does a stored document name `ref` anywhere — a resource, the claim, or a `via` hop? */
export function documentMentions(document: unknown, ref: string): boolean {
  if (typeof document !== 'object' || document === null) return false;
  const doc = document as { claim?: { ref?: unknown }; resources?: unknown };
  if (doc.claim?.ref === ref) return true;
  if (!Array.isArray(doc.resources)) return false;
  return (doc.resources as { ref?: unknown; claim?: { via?: { ref?: unknown } } }[]).some(
    (r) => r.ref === ref || r.claim?.via?.ref === ref,
  );
}

/** Stored endpoint rows → the map `deriveScopeDocument` reads. Unparseable rows are left out. */
export function endpointMap(rows: readonly Pick<PublicEndpoint, 'id' | 'ref' | 'definition'>[]): Map<string, DeriveEndpoint> {
  const out = new Map<string, DeriveEndpoint>();
  for (const row of rows) {
    const parsed = parseDefinition(row.definition);
    if (parsed.ok) out.set(row.id, { id: row.id, ref: row.ref, definition: parsed.definition });
  }
  return out;
}

/** Issues without repeats, by code + ref + column. */
export function dedupeIssues(issues: readonly ScopeIssue[]): ScopeIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = issueKey(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
