// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End-customer claims and the predicate they buy (28-public-surface.md §3.4,
 * 28-T19).
 *
 * ── ADMINIUM GROWS NO SECOND IDENTITY SYSTEM ───────────────────────────────
 * A claimed customer is a row in `adminium_public_sessions` and nothing else.
 * There is no user, no password, no profile — deliberately (§3.4). The whole of
 * what a claim produces is a `ClaimGrant`: one column, one value, on one
 * resource. Everything downstream is that grant ANDed into a query.
 *
 * ── THE HONEST LIMIT, STATED WHERE THE CODE IS ─────────────────────────────
 * In the `lookup` tier, POSSESSION OF A REFERENCE **IS** THE CREDENTIAL. Someone
 * who knows an order number and an email is that customer as far as this
 * module is concerned. That is acceptable for "track my order" and is not
 * acceptable for a medical record, which is why `compileScope` refuses the
 * `lookup` strategy on a resource the operator marked `sensitive` (D11/D17) —
 * boot-fatal, not advisory. The rate limiter is the only thing bounding a walk
 * of the reference space, and it is an in-process `Map`; both facts are
 * recorded rather than hidden.
 *
 * ── EVERY FAILURE IS THE SAME FAILURE ──────────────────────────────────────
 * No match, several matches, missing field, unknown column, wrong tier — one
 * outcome, `null`, and the route answers one code. A claim endpoint that says
 * "that reference exists but the email is wrong" is an oracle that turns a
 * two-factor lookup into two one-factor lookups.
 */

import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { RecordFilter } from '../crud/filters.js';
import type { CompiledResource, CompiledScope } from './scope.js';

/** What a session is: one column pinned to one value, on one resource. */
export interface ClaimGrant {
  /** The ref the claim was made against. */
  ref: string;
  /** The column on THAT resource which identifies the claimant. */
  column: string;
  /** The value it must equal. Never sent to the browser. */
  value: unknown;
}

export const CLAIM_SESSION_TTL_MS = 30 * 60_000;

/** A resolved session, as the request path sees it. */
export interface PublicSessionContext {
  id: string;
  keyId: string;
  grant: ClaimGrant;
}

export function parseGrant(json: string): ClaimGrant | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ClaimGrant).ref === 'string' &&
      typeof (parsed as ClaimGrant).column === 'string'
    ) {
      return parsed as ClaimGrant;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Resolve a claim against the database.
 *
 * `match` values are compared with EQUALITY ONLY, against exactly the columns
 * the scope declared. No `like`, no ranges, no partial matches — a claim is an
 * identity check, and every operator the filter grammar offers is a way to turn
 * one into a search.
 *
 * Returns the grant on exactly one match, and `null` on anything else.
 */
export async function resolveClaim(opts: {
  db: Kysely<SourceDatabase>;
  table: ResolvedTable;
  resource: CompiledResource;
  scope: CompiledScope;
  /** Caller-supplied `{ column: value }`. */
  match: Record<string, unknown>;
}): Promise<ClaimGrant | null> {
  const { db, table, resource, scope, match } = opts;
  const claim = scope.claim;
  // `CompiledScope.claim` is `PublicScopeDocument['claim'] | null`, and that
  // field is itself optional — so `undefined` has to be refused alongside null.
  if (claim === null || claim === undefined) return null;
  if (resource.claim?.column === undefined) return null;

  /*
   * EVERY declared column must be supplied, and NOTHING else may be. A caller
   * who can omit one factor has a one-factor lookup; a caller who can add one
   * has a search.
   */
  const declared = [...claim.match].sort();
  const supplied = Object.keys(match).sort();
  if (declared.length !== supplied.length) return null;
  if (declared.some((c, i) => c !== supplied[i])) return null;

  let query = db.selectFrom(table.id).selectAll();
  for (const column of declared) {
    // Resolved against the snapshot, so the identifier reaching SQL is the
    // snapshot's own — never the caller's string.
    if (!table.columns.has(column)) return null;
    query = query.where(db.dynamic.ref(column), '=', match[column] as never);
  }

  // Two rows is a failed identity check, not an ambiguous one. Fetching a
  // third would tell us nothing more, so the limit is 2.
  const rows = (await query.limit(2).execute()) as Record<string, unknown>[];
  if (rows.length !== 1) return null;

  const row = rows[0] as Record<string, unknown>;
  const value = row[resource.claim.column];
  if (value === undefined || value === null) return null;

  return { ref: claim.ref, column: resource.claim.column, value };
}

/**
 * The predicate a session adds to ONE resource, or `null` when it adds none.
 *
 * ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
 * A resource that DECLARES a claim is unreachable without a session. Not
 * "unfiltered" — unreachable. The alternative is a resource whose scoping
 * silently evaporates when the session expires, which is precisely the failure
 * this design exists to make impossible.
 *
 * Callers must therefore treat `{ reachable: false }` as a 404, using the same
 * body as an unknown ref (§3.2).
 */
export function claimPredicateFor(
  resource: CompiledResource,
  session: PublicSessionContext | null,
): { reachable: true; predicate: RecordFilter | null } | { reachable: false } {
  if (resource.claim === null) return { reachable: true, predicate: null };
  if (session === null) return { reachable: false };

  if (resource.claim.column !== undefined) {
    /*
     * The grant applies to EVERY resource that declared a claim column, not
     * only the ref it was minted against — that is what makes "my invoices"
     * work from a session claimed on an order.
     *
     * It is not a hole, and the reason is worth stating: the operator wrote
     * `claim.column` on each of those resources in a document that `compileScope`
     * checked, so "this column identifies the same customer" is an assertion
     * they made deliberately, not one inferred from two columns sharing a name.
     * A resource without `claim` gets no predicate; a resource with one gets
     * exactly this.
     */
    return {
      reachable: true,
      predicate: { column: resource.claim.column, op: 'eq', value: session.grant.value },
    };
  }

  /*
   * `via` — ONE hop. The referencing column on this resource must equal the
   * grant's value, which is what makes "my order's line items" work without a
   * join. Two hops is a join planner with an authorization boundary inside it
   * and §3.4 refuses it; `compileScope` has already rejected anything deeper.
   */
  if (resource.claim.via !== undefined) {
    return {
      reachable: true,
      predicate: { column: resource.claim.via.localColumn, op: 'eq', value: session.grant.value },
    };
  }

  return { reachable: false };
}

/**
 * Combine the scope's mandatory predicate with the session's.
 *
 * Both are ANDed and neither is optional. Order is irrelevant to correctness
 * and fixed anyway so the compiled SQL is stable across requests.
 */
export function combinePredicates(
  mandatory: RecordFilter | null,
  claim: RecordFilter | null,
): RecordFilter | null {
  if (mandatory === null) return claim;
  if (claim === null) return mandatory;
  return { and: [mandatory, claim] };
}
