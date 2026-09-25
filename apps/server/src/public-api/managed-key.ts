// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an installed app's own browser key may hold, and what nobody may do to
 * the endpoints it uses — the key made in the operator's name at install, so
 * it must stay as narrow as the install check said it was.
 *
 * A managed key may hold:
 *  - GET and POST;
 *  - PATCH only on an endpoint that needs a signed-in guest (the session
 *    reaches the claimant's own row alone), and only while its `writable`
 *    names no column Adminium decides — a copied price, a code, a running
 *    number, a total, a stamp;
 *  - never PUT, DELETE or BATCH (a batch updates every row the key reaches).
 * And an anonymous create never also offers GET: the single-row read by id
 * would let anyone read every booking by guessing ids.
 *
 * An edit to an endpoint a managed key uses is refused when it adds a write
 * method, takes away the sign-in, or widens what the key sees: more columns,
 * or a filter loosened. Keys have no route that edits their access, so this
 * is the one way such a key could widen. Hand-made keys are not limited here.
 */
import type { Widening } from './derive.js';
import type { PublicEndpointDefinition, PublicMethod } from './endpoint.js';
import type { ScopeIssue } from './scope.js';

export const KEY_MANAGED_UNSAFE = 'KEY_MANAGED_UNSAFE';

/** The override ops whose column Adminium decides; a guest never writes one. */
export const DECIDED_COLUMN_OPS: readonly string[] = [
  'column.copy',
  'column.code',
  'column.sequence',
  'column.rollup',
  'column.stamp',
  'column.formula',
  'column.format',
];

const WRITE_METHODS: ReadonlySet<PublicMethod> = new Set(['POST', 'PATCH', 'PUT', 'DELETE', 'BATCH']);
const NEVER: ReadonlySet<PublicMethod> = new Set(['PUT', 'DELETE', 'BATCH']);

const unsafe = (ref: string, message: string, column?: string): ScopeIssue => ({
  code: KEY_MANAGED_UNSAFE,
  message,
  ref,
  ...(column === undefined ? {} : { column }),
});

/** Needs a signed-in guest: only their own rows. */
const claimGated = (definition: PublicEndpointDefinition) => definition.auth.role === 'authenticated';

/**
 * Why a managed key may not hold `methods` on this endpoint, or nothing.
 * `decided` names the source table's columns Adminium decides.
 */
export function managedGrantIssues(
  ref: string,
  definition: PublicEndpointDefinition,
  methods: readonly PublicMethod[],
  decided: ReadonlySet<string>,
): ScopeIssue[] {
  const out: ScopeIssue[] = [];
  for (const method of methods) {
    if (NEVER.has(method)) out.push(unsafe(ref, `an app’s own key may not hold ${method} on "${ref}"`));
  }
  if (methods.includes('PATCH')) {
    if (!claimGated(definition)) {
      out.push(unsafe(ref, `an app’s own key may hold PATCH on "${ref}" only where a guest signs in to reach their own row`));
    }
    for (const column of definition.writable ?? []) {
      if (decided.has(column)) {
        out.push(unsafe(ref, `"${column}" is decided by Adminium, so a guest may not change it through "${ref}"`, column));
      }
    }
  }
  if (definition.auth.role === 'anon' && definition.methods.includes('POST') && definition.methods.includes('GET')) {
    out.push(unsafe(ref, `"${ref}" lets anyone create a row, so it may not also let anyone read one`));
  }
  return out;
}

/** Why an edit to an endpoint a managed key uses is refused, or nothing. */
export function managedEditIssues(
  ref: string,
  before: PublicEndpointDefinition | null,
  after: PublicEndpointDefinition,
  gains: readonly Widening[],
): ScopeIssue[] {
  const out: ScopeIssue[] = [];
  if (before !== null) {
    const had = new Set(before.methods);
    const added = after.methods.filter((method) => WRITE_METHODS.has(method) && !had.has(method));
    if (added.length > 0) out.push(unsafe(ref, `an app’s own key uses "${ref}", so it may not gain ${added.join(', ')}`));
    if (claimGated(before) && !claimGated(after)) {
      out.push(unsafe(ref, `an app’s own key uses "${ref}", so it must keep asking guests to sign in`));
    }
    if (before.identity !== undefined && after.identity === undefined) {
      out.push(unsafe(ref, `an app’s own key signs guests in through "${ref}", so it must keep its claim`));
    }
  }
  for (const gain of gains) {
    if (gain.columns.length > 0) {
      out.push(unsafe(gain.ref, `an app’s own key would see more of "${gain.ref}": ${gain.columns.join(', ')}`));
    }
    if (gain.rows) out.push(unsafe(gain.ref, `an app’s own key would reach more rows of "${gain.ref}"`));
    if (gain.methods.length > 0) {
      out.push(unsafe(gain.ref, `an app’s own key would gain ${gain.methods.join(', ')} on "${gain.ref}"`));
    }
  }
  return out;
}
