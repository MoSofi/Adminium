// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RULES ADMINIUM READS BUT DOES NOT RUN YET.
 *
 * A manifest may declare a rule before the server that keeps it is built: the
 * words land first, so an app can be written, validated and installed against
 * them, and the rule's behaviour follows. Until it does, a table that carries
 * one refuses every create and change — 501 `RULE_NOT_BUILT {table, rule}` —
 * rather than write rows the rule would have refused: a limit that counts
 * nothing sells what is not there, and a condition that is never checked lets
 * any move through. A delete is let through (it can break no limit), so sample
 * rows and an uninstall still clear up.
 *
 * A public entry that declares such a rule refuses its requests the same way,
 * before anything is read: an entry whose filter is not built yet would
 * otherwise answer as a plain list of the whole table.
 *
 * Each detector is removed in the change that builds its rule. A release
 * ships with both lists empty (a test says so).
 */
import { AppError } from '../errors.js';
import type { EffectiveTable } from '../connections/effective-schema.js';

export interface UnbuiltTableRule {
  /** The rule's name as the refusal gives it (`capacity.kind`, `states.timed`, …). */
  rule: string;
  /** Whether this table's stored rules use it. */
  on: (table: EffectiveTable) => boolean;
}

export interface UnbuiltEntryRule {
  rule: string;
  /** Whether this stored public entry (its parsed definition) uses it. */
  on: (entry: Readonly<Record<string, unknown>>) => boolean;
}

export const UNBUILT_TABLE_RULES: readonly UnbuiltTableRule[] = [];

export const UNBUILT_ENTRY_RULES: readonly UnbuiltEntryRule[] = [
  { rule: 'withhold', on: (entry) => entry['withhold'] !== undefined },
];

/** 501: the table (or entry) declares a rule this server cannot keep yet. */
export class RuleNotBuiltError extends AppError {
  override readonly name = 'RuleNotBuiltError';

  constructor(table: string, rule: string) {
    super(501, 'RULE_NOT_BUILT', `"${table}" declares a rule this server does not run yet (${rule}), so it takes no writes.`, { table, rule });
  }
}

/** The first rule of this table's that is not built yet, or null. */
export function unbuiltRuleOf(table: EffectiveTable | undefined, rules: readonly UnbuiltTableRule[] = UNBUILT_TABLE_RULES): string | null {
  if (table === undefined) return null;
  return rules.find((candidate) => candidate.on(table))?.rule ?? null;
}

/** Throws `RULE_NOT_BUILT` for a table that carries a rule not built yet. */
export function refuseUnbuiltTable(target: { table: { id: string; table: EffectiveTable | undefined } }, rules?: readonly UnbuiltTableRule[]): void {
  const rule = unbuiltRuleOf(target.table.table, rules);
  if (rule !== null) throw new RuleNotBuiltError(target.table.id, rule);
}

/** The first rule of this public entry's that is not built yet, or null. */
export function unbuiltEntryRuleOf(
  entry: Readonly<Record<string, unknown>>,
  rules: readonly UnbuiltEntryRule[] = UNBUILT_ENTRY_RULES,
): string | null {
  return rules.find((candidate) => candidate.on(entry))?.rule ?? null;
}
