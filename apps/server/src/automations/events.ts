// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OCCURRENCE IDENTITY (42-automations-and-workflow-logs.md D6, §3.3).
 *
 * Four producers can decide the same thing happened, and the ONLY reason a
 * dashboard-created row does not fire a rule twice is that the route matcher
 * and the watch poller compute the same string here. That makes these
 * functions load-bearing in a way their size does not suggest: change how a
 * key is spelled on one side only, and the product starts sending two welcome
 * emails to every person who signs up through the dashboard.
 *
 * The keys, per producer:
 *
 *   route `created`   `<rule>:<pk>`                    ← same as the poller's
 *   watch `created`   `<rule>:<pk>`
 *   route `updated`   `<rule>:<pk>:<updated_at>`       ← when the table has one
 *   watch `updated`   `<rule>:<pk>:<updated_at>`
 *   route `updated`   null                             ← when it has not
 *   route `deleted`   null
 *   schedule once     `<rule>:<pk>`
 *   schedule per tick `<rule>:<pk>:<tick>`
 *   schedule bare     `<rule>:tick:<tick>`
 *
 * NULL means "no identity to collapse on", which the unique index exempts —
 * two updates in a row on a table with no `updated_at` are two occurrences,
 * and that is the honest answer.
 *
 * ─── Why the pk part is built from `table.primaryKey` ──────────────────────
 *
 * `Object.keys(pk)` is insertion order, and two producers can build the same
 * map in two orders. The snapshot's own column order is the one thing both
 * sides already agree on, so the key is composed from it — never from the
 * object's own iteration order (the jsonb pk-order lesson, learnt on a
 * different table).
 */

import { createHash } from 'node:crypto';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';

/** `adminium_automation_runs.dedupe_key` is str(160) (migration 0028). */
const MAX_KEY = 160;

/**
 * A pk map as one deterministic string. JSON-encoded per component so that
 * `{a: '1|2', b: '3'}` and `{a: '1', b: '2|3'}` cannot collide.
 */
export function pkKey(table: ResolvedTable, pk: Row): string {
  const columns = table.primaryKey.length > 0 ? table.primaryKey : Object.keys(pk).sort();
  return columns.map((column) => JSON.stringify(pk[column] ?? null)).join(',');
}

/**
 * Fit a key into the column. Hashed, never truncated: truncation collapses
 * two DIFFERENT records onto one key, and the failure mode is a run that
 * silently never happens.
 */
export function capKey(key: string): string {
  if (key.length <= MAX_KEY) return key;
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `${key.slice(0, MAX_KEY - 33)}#${digest}`;
}

export function recordOccurrenceKey(input: {
  ruleId: string;
  table: ResolvedTable;
  pk: Row;
  /** The `updated_at`-shaped column's value, when the table has one. */
  changeStamp?: unknown;
}): string {
  const base = `${input.ruleId}:${pkKey(input.table, input.pk)}`;
  if (input.changeStamp === undefined) return capKey(base);
  return capKey(`${base}:${stampOf(input.changeStamp)}`);
}

export function scheduleOccurrenceKey(input: {
  ruleId: string;
  table: ResolvedTable | null;
  pk: Row | null;
  /** Omitted when the rule says "once per record". */
  tick?: number | undefined;
}): string {
  const subject =
    input.table === null || input.pk === null ? 'tick' : pkKey(input.table, input.pk);
  const base = `${input.ruleId}:${subject}`;
  return capKey(input.tick === undefined ? base : `${base}:${input.tick}`);
}

/** One column value as a stable string, whatever the driver returned. */
export function stampOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return String(value.getTime());
  return String(value);
}
