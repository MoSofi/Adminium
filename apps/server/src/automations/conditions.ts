// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CONDITION EVALUATION.
 *
 * The comp draws one row — Field · operator · Value (Automation Rules
 * 124-137) — and that is what most conditions are. Two things are added
 * because the owner's own examples need them and neither is expressible
 * as a field comparison:
 *
 *  - the RELATED-RECORDS count (FILL F5): "did this user claim the offer?",
 *    "has this patient missed an appointment before?". It runs one COUNT
 *    query through the CRUD list pipeline, which is why the caller supplies
 *    `countRelated` rather than this module reaching for a database.
 *  - the four RELATIVE-TIME operators (D5), which is how a schedule scan says
 *    "starts within the next two hours" without anybody typing a timestamp.
 *
 * ─── Comparison rules, and why they are stated rather than inferred ────────
 *
 * A customer's column can be a number, a string that looks like a number, a
 * driver Date, or a NULL that means three different things. The rules are
 * therefore fixed and dull: if BOTH sides read as numbers, compare numbers;
 * otherwise compare strings, trimmed, and case-insensitively for `is`,
 * `is not` and `contains`. `1` is `1`; `Active` is `active`; `10` is greater
 * than `9` and `"10"` is greater than `"9"` — which is the answer a person
 * expects and the one a naive string comparison gets wrong.
 *
 * ─── Missing is not empty is not false ─────────────────────────────────────
 *
 * A condition on a record that is GONE never evaluates here: the runner ends
 * such a run `skipped` before it asks ("re-read the record at every step").
 * What this module does see is a column whose value is NULL or '', and `is
 * empty` is the only operator that treats them alike.
 */

import type {
  AutomationCondition,
  AutomationConditionOp,
  AutomationRelativeOperand,
} from '@adminium/meta';
import { automationDurationMs, isRelativeAutomationOp } from '@adminium/meta';

import type { Row } from '../crud/mask.js';

/** What "count the related rows" needs; the caller owns the query (F5). */
export interface RelatedCountSpec {
  table: string;
  matchColumn: string;
  /** The value of THIS record's `equalsField`. */
  matchValue: unknown;
  where?: AutomationCondition | undefined;
}

export interface ConditionContext {
  /** The record, re-read and UNMASKED. Null for a schedule tick with no record. */
  row: Row | null;
  now: number;
  /** Absent ⇒ a count condition cannot be answered and evaluates false. */
  countRelated?: ((spec: RelatedCountSpec) => Promise<number>) | undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A date column's value, whatever the driver handed back: a Date (pg,
 * mysql2), an epoch number, or a string (SQLite text, and pg `date`).
 * Returns null for anything that is not a date — which is how a relative
 * operator on a non-date column evaluates false instead of throwing. The
 * SAVE path refuses that combination outright; this is the belt.
 */
export function asInstant(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    // `2026-09-08 14:30:00` — SQLite's own spelling, which Date.parse handles
    // on every engine this runs on, but a bare `HH:mm:ss` does not.
    const spaced = Date.parse(value.replace(' ', 'T'));
    return Number.isNaN(spaced) ? null : spaced;
  }
  return null;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function compareValues(op: AutomationConditionOp, left: unknown, right: unknown): boolean {
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    switch (op) {
      case 'is':
        return leftNumber === rightNumber;
      case 'is_not':
        return leftNumber !== rightNumber;
      case 'gt':
        return leftNumber > rightNumber;
      case 'lt':
        return leftNumber < rightNumber;
      case 'contains':
        return asText(left).includes(asText(right));
      default:
        return false;
    }
  }
  const leftText = asText(left).trim();
  const rightText = asText(right).trim();
  switch (op) {
    case 'is':
      return leftText.toLowerCase() === rightText.toLowerCase();
    case 'is_not':
      return leftText.toLowerCase() !== rightText.toLowerCase();
    case 'contains':
      return leftText.toLowerCase().includes(rightText.toLowerCase());
    case 'gt':
      return leftText > rightText;
    case 'lt':
      return leftText < rightText;
    default:
      return false;
  }
}

/** The four relative-time operators, resolved against `now` (D5). */
export function evaluateRelative(
  op: AutomationConditionOp,
  value: unknown,
  operand: AutomationRelativeOperand,
  now: number,
): boolean {
  const at = asInstant(value);
  if (at === null) return false;
  const span = automationDurationMs(operand.amount, operand.unit);
  switch (op) {
    case 'within_next':
      return at >= now && at <= now + span;
    case 'within_last':
      return at <= now && at >= now - span;
    case 'more_than_ago':
      return at < now - span;
    case 'more_than_ahead':
      return at > now + span;
    default:
      return false;
  }
}

function isRelativeOperand(right: unknown): right is AutomationRelativeOperand {
  return typeof right === 'object' && right !== null && 'amount' in right && 'unit' in right;
}

export async function evaluateCondition(
  condition: AutomationCondition,
  ctx: ConditionContext,
): Promise<boolean> {
  const { op } = condition;

  if ('count' in condition.left) {
    if (!ctx.countRelated || ctx.row === null) return false;
    const spec = condition.left.count;
    const count = await ctx.countRelated({
      table: spec.table,
      matchColumn: spec.matchColumn,
      matchValue: ctx.row[spec.equalsField] ?? null,
      where: spec.where as AutomationCondition | undefined,
    });
    return compareValues(op, count, condition.right ?? null);
  }

  const value = ctx.row === null ? null : ctx.row[condition.left.field];
  if (op === 'is_empty') return isEmptyValue(value);
  if (op === 'not_empty') return !isEmptyValue(value);
  if (isRelativeAutomationOp(op)) {
    return isRelativeOperand(condition.right)
      ? evaluateRelative(op, value, condition.right, ctx.now)
      : false;
  }
  if (condition.right === undefined) return false;
  return compareValues(op, value, condition.right);
}

/** Every condition must hold — the trigger's `when` and a for-each `where`. */
export async function evaluateAll(
  conditions: readonly AutomationCondition[],
  ctx: ConditionContext,
): Promise<boolean> {
  for (const condition of conditions) {
    if (!(await evaluateCondition(condition, ctx))) return false;
  }
  return true;
}

/** Is this condition filled in enough to be evaluated? (D12's completeness.) */
export function isConditionComplete(condition: AutomationCondition): boolean {
  const needsOperand = condition.op !== 'is_empty' && condition.op !== 'not_empty';
  if (needsOperand && (condition.right === undefined || condition.right === '')) return false;
  if ('count' in condition.left) {
    const { table, matchColumn, equalsField } = condition.left.count;
    return table !== '' && matchColumn !== '' && equalsField !== '';
  }
  return condition.left.field !== '';
}
