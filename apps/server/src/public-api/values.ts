// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ACTUALLY GETS WRITTEN — caller values, the scope's defaults, and the
 * claim, resolved into one row.
 *
 * ── WHY IT IS A MODULE AND NOT A CLOSURE ────────────────────────────────────
 *
 * It lived inside the route plugin, which meant the one function in the public
 * surface that decides what a stranger may put in an operator's database could
 * only be exercised by standing up a server, a meta store, a connection and a
 * key. Nothing did, so it had no direct test at all — and the review that
 * found it was explicit: this is "security-critical new code [that] needs
 * property tests".
 *
 * It captured nothing from the closure. Moving it out cost one import and
 * bought a test file; the behaviour is unchanged, line for line.
 */
import type { Dialect } from '@adminium/engine';

import type { PublicSessionContext } from './claim.js';
import { readGenerator, resolveDefaults } from './generate.js';
import type { CompiledResource } from './scope.js';

/**
 * Caller values → the row that will actually be written.
 *
 * Two rules, and the second is the one that is easy to get wrong. Only
 * `writable` columns survive — anything else is a refusal, not a silent drop,
 * because silently ignoring a field the caller sent produces a row that is
 * not what they asked for and no way to tell. And `defaults` are applied
 * AFTER, overwriting whatever arrived, which is what makes them immutable
 * rather than merely suggested.
 */
/**
 * A resource's literal defaults, with every `$generate` sentinel removed.
 *
 * The update path's half of the rule below. It walks rather than caching
 * because a resource's `defaults` is a handful of keys and a cache keyed by
 * resource would outlive a scope edit.
 */
const dropGeneratedDefaults = (
  defaults: Readonly<Record<string, unknown>>,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(defaults).filter(([, v]) => readGenerator(v) === null));

export const prepareValues = (
  resource: CompiledResource,
  values: Record<string, unknown>,
  session: PublicSessionContext | null,
  action: 'create' | 'update',
  dialect: Dialect,
): Record<string, unknown> | null => {
  for (const column of Object.keys(values)) {
    if (!resource.writable.has(column)) return null;
  }
  /*
   * `$generate` SENTINELS RESOLVE ON CREATE AND ARE DROPPED ON
   * UPDATE.
   *
   * `defaults` have always been applied on both paths, and for a literal that
   * is harmless — it rewrites the same constant. A MINTED default is not: run
   * on update it would hand the row a fresh `id` and a fresh `created_at` on
   * every patch a visitor makes, which is a data-loss bug wearing the costume
   * of a default. So the sentinels are resolved for a create and skipped
   * entirely for an update — skipped, not resolved-and-discarded, so nothing
   * mints a uuid nobody will read.
   *
   * `updated_at` on update is deliberately NOT bought here. It is the records
   * path's concern (09), it wants the same treatment on the dashboard's own
   * writes, and doing half of it through a public scope's `defaults` would
   * leave two mechanisms disagreeing about the same column.
   */
  const defaults =
    action === 'create'
      ? resolveDefaults(resource.defaults, dialect, new Date())
      : dropGeneratedDefaults(resource.defaults);
  const out: Record<string, unknown> = { ...values, ...defaults };

  /*
   * THE CLAIM WRITES ITSELF IN.
   *
   * A claim-gated resource almost always owns its rows through a NOT NULL
   * column — `enquiries.patient_id`, `orders.customer_id`. Without this, a
   * claimed create can never satisfy that column: the caller must not be
   * allowed to set it (they would write rows as somebody else) and `defaults`
   * cannot carry it (it differs per session). So the grant supplies it,
   * LAST, after `defaults`, and therefore unoverridable by either.
   *
   * Found by a live probe: the write failed on a not-null violation and the
   * only honest fix was for the session to provide the value it already
   * proves.
   */
  if (session !== null && resource.claim?.column !== undefined) {
    out[resource.claim.column] = session.grant.value;
  }
  return out;
};
