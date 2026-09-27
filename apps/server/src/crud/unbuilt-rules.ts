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
import type { EffectiveColumn, EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';

export interface UnbuiltTableRule {
  /** The rule's name as the refusal gives it (`capacity`, `states.timed`, …). */
  rule: string;
  /**
   * Whether a write to this table meets the rule: its own stored rules, or
   * (with the model) another table's rule that this table's rows feed.
   */
  on: (table: EffectiveTable, model?: Pick<EffectiveModel, 'tables' | 'relations'>) => boolean;
}

export interface UnbuiltEntryRule {
  rule: string;
  /** Whether this stored public entry (its parsed definition) uses it. */
  on: (entry: Readonly<Record<string, unknown>>) => boolean;
}

/** Whether any column of the table carries a rule the test finds. */
const anyColumn = (table: EffectiveTable, test: (column: EffectiveColumn) => boolean): boolean => (table.columns ?? []).some(test);

/** Whether a formula (at any depth) uses one of these operators. */
function formulaUses(formula: unknown, ops: readonly string[]): boolean {
  if (typeof formula !== 'object' || formula === null) return false;
  if (Array.isArray(formula)) return formula.some((part) => formulaUses(part, ops));
  return Object.entries(formula).some(([key, value]) => ops.includes(key) || formulaUses(value, ops));
}

/** The tables a column's foreign key points at, through the model's relations. */
function targetOf(model: Pick<EffectiveModel, 'relations'>, tableId: string, column: string): string | undefined {
  return (model.relations ?? []).find((r) => r.through === null && r.from.tableId === tableId && r.from.columns.length === 1 && r.from.columns[0] === column)?.to
    .tableId;
}

const movesOf = (table: EffectiveTable) =>
  Object.values(table.states?.moves ?? {}).flatMap((list) => list.filter((move): move is Exclude<typeof move, string> => typeof move === 'object'));

export const UNBUILT_TABLE_RULES: readonly UnbuiltTableRule[] = [
  // Codes a guest types, and a code renewed when the ticket changes hands.
  { rule: 'lookup', on: (table) => anyColumn(table, (c) => c.lookup !== undefined) },
  { rule: 'normalize.code', on: (table) => anyColumn(table, (c) => c.normalize === 'code') },
  { rule: 'code.renew', on: (table) => anyColumn(table, (c) => c.code?.renew !== undefined) },
  // Totals that count rows: the parent's column, and every table whose rows it counts.
  {
    rule: 'rollup.count',
    on: (table, model) =>
      anyColumn(table, (c) => c.rollup?.count === true) ||
      (model?.tables ?? []).some((other) => (other.columns ?? []).some((c) => c.rollup?.count === true && c.rollup.from === table.id)),
  },
  // Prices by the night, a copy that follows its source, a text joined from columns.
  { rule: 'perNight', on: (table) => anyColumn(table, (c) => c.perNight !== undefined) },
  {
    rule: 'copy.follow',
    on: (table, model) =>
      anyColumn(table, (c) => c.copy?.follow === true) ||
      (model?.tables ?? []).some((other) =>
        (other.columns ?? []).some((c) => c.copy?.follow === true && model !== undefined && targetOf(model, other.id, c.copy.via) === table.id),
      ),
  },
  { rule: 'formula.join', on: (table) => anyColumn(table, (c) => formulaUses(c.formula, ['join'])) },
  // Stamps worked out from minutes, a deadline or a moment, and one written when columns change.
  {
    rule: 'stamp',
    on: (table) =>
      anyColumn(table, (c) => {
        const stamp = c.stamp;
        if (stamp === undefined) return false;
        const set = stamp.set;
        const newSet = typeof set === 'object' && ('addMinutes' in set || 'deadline' in set || 'moment' in set);
        const triggers = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
        return newSet || triggers.some((t) => typeof t === 'object' && 'columns' in t);
      }),
  },
  // A document's life: strict moves, conditions on moves, late flags, timed moves, moves that change a linked row.
  { rule: 'states.strict', on: (table) => table.states?.strict !== undefined },
  { rule: 'states.late', on: (table) => table.states?.late !== undefined },
  { rule: 'states.timed', on: (table) => table.states?.timed !== undefined },
  { rule: 'states.effects', on: (table) => table.states?.effects !== undefined },
  {
    rule: 'states.requires',
    on: (table) => movesOf(table).some((move) => move.requires?.linked !== undefined || move.requires?.time !== undefined || move.requires?.setting !== undefined),
  },
];

/** Whether a public entry's `writable_when` has a window read from moments (not the `within` form). */
const momentWindow = (entry: Readonly<Record<string, unknown>>): boolean =>
  Object.values((entry['writable_when'] as Record<string, unknown> | undefined) ?? {}).some(
    (when) => typeof when === 'object' && when !== null && !Array.isArray(when) && !('within' in when),
  );

/** The entry keys (as the endpoint definition spells them) whose behaviour is not built yet. */
const ENTRY_KEYS = [
  // Availability for every kind of limit, and what is left said only when little is.
  'capacity_rule',
  'show_left',
  'under',
  // Rows unlocked by a typed code, and pictures anyone may see.
  'unlock_by',
  'pictures',
  // A create with its child rows, its checks, a dry run, the price it expects, a retry key.
  'children',
  'agrees',
  'dry_run',
  'expect',
  'client_key',
  // A person found by address, the new row's own link, a read for a session, forgetting.
  'find_or_create',
  'share_link',
  'session_only',
] as const;

/*
 * Not here, on purpose: a sign-in entry's own link (`identity.own`) and its
 * "delete my details" (`forget`). Unbuilt, each gives less than it will — the
 * link opens read-only, and there is no route to forget by — never more; and
 * suspending a sign-in entry would leave every entry that needs a signed-in
 * customer with nothing to sign in by, so the app would not install.
 */
export const UNBUILT_ENTRY_RULES: readonly UnbuiltEntryRule[] = [
  ...ENTRY_KEYS.map((key) => ({ rule: key, on: (entry: Readonly<Record<string, unknown>>) => entry[key] !== undefined })),
  { rule: 'writable_when', on: momentWindow },
  // A change's limits: per value a day, plain text only.
  { rule: 'limits', on: (entry) => entry['limits'] !== undefined },
  // Columns withheld from rows read through a parent (a ticket handed to a friend).
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
export function unbuiltRuleOf(
  table: EffectiveTable | undefined,
  rules: readonly UnbuiltTableRule[] = UNBUILT_TABLE_RULES,
  model?: Pick<EffectiveModel, 'tables' | 'relations'>,
): string | null {
  if (table === undefined) return null;
  return rules.find((candidate) => candidate.on(table, model))?.rule ?? null;
}

/** Throws `RULE_NOT_BUILT` for a table that carries a rule not built yet. */
export function refuseUnbuiltTable(
  target: { table: { id: string; table: EffectiveTable | undefined }; view?: { model: Pick<EffectiveModel, 'tables' | 'relations'> } | undefined },
  rules?: readonly UnbuiltTableRule[],
): void {
  const rule = unbuiltRuleOf(target.table.table, rules, target.view?.model);
  if (rule !== null) throw new RuleNotBuiltError(target.table.id, rule);
}

/** The first rule of this public entry's that is not built yet, or null. */
export function unbuiltEntryRuleOf(
  entry: Readonly<Record<string, unknown>>,
  rules: readonly UnbuiltEntryRule[] = UNBUILT_ENTRY_RULES,
): string | null {
  return rules.find((candidate) => candidate.on(entry))?.rule ?? null;
}
