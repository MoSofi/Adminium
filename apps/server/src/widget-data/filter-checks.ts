// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What makes a card's filters readable, judged the same way where a card is
 * read (the widget compiler) and where an app's Overview is installed (the
 * plan check): sixteen conditions in all, groups two deep, and a venue
 * `day` — never with a `value` or a `param`, only by `eq`, `neq`, `gt`, `gte`,
 * `lt` or `lte` (`neq` on a date column only: on a time column a day is a
 * span), on a date or time column, and a real day (`YYYY-MM-DD`, or `today`
 * up to ten years either way). One rule set, so an install never passes a card
 * that every read refuses.
 */
import { MAX_FILTER_CONDITIONS, MAX_FILTER_GROUP_DEPTH } from '../crud/filters.js';
import { LINK_DAY_OFFSET_MAX } from './link-filters.js';

/** What a filter's column holds, as far as a day is concerned; `unknown` when the checker cannot say (a column one link away). */
export type DayColumnKind = 'date' | 'time' | 'other' | 'unknown';

export interface FilterProblem {
  message: string;
  details: Record<string, unknown>;
}

const DAY_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);

/** A day a filter may name: `today`, `today±n` (n ≤ ten years), or a real calendar day. */
export function isVenueDay(day: string): boolean {
  if (day === 'today') return true;
  const offset = /^today[+-](\d{1,4})$/.exec(day);
  if (offset !== null) return Number(offset[1]) <= LINK_DAY_OFFSET_MAX;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
}

type Node = { and?: unknown[]; or?: unknown[]; column?: unknown; op?: unknown; day?: unknown; value?: unknown; param?: unknown };

/** The first thing about these filters no read would take, or null. */
export function filterProblem(filters: readonly unknown[] | undefined, kindOf: (column: string) => DayColumnKind = () => 'unknown'): FilterProblem | null {
  let conditions = 0;
  let problem: FilterProblem | null = null;
  const walk = (raw: unknown, depth: number): void => {
    if (problem !== null || typeof raw !== 'object' || raw === null) return;
    const node = raw as Node;
    const group = Array.isArray(node.and) ? node.and : Array.isArray(node.or) ? node.or : null;
    if (group !== null) {
      if (depth >= MAX_FILTER_GROUP_DEPTH) problem = { message: 'Filter groups may nest at most 2 levels deep.', details: { maxDepth: MAX_FILTER_GROUP_DEPTH } };
      for (const child of group) walk(child, depth + 1);
      return;
    }
    conditions += 1;
    if (node.day === undefined) return;
    const column = String(node.column);
    const day = String(node.day);
    const op = String(node.op);
    if (node.value !== undefined || node.param !== undefined) {
      problem = { message: 'A filter compares with a `day` or with a `value` (or a `param`), not both.', details: { column } };
    } else if (!DAY_OPS.has(op)) {
      problem = { message: `A day is compared by eq, neq, gt, gte, lt or lte, not "${op}".`, details: { column, op, day } };
    } else if (!isVenueDay(day)) {
      problem = { message: `"${day}" is not a day: write today, today+n, today-n or YYYY-MM-DD.`, details: { column, day } };
    } else {
      const kind = kindOf(column);
      if (kind === 'other') problem = { message: `"${column}" keeps neither a date nor a time: it cannot be compared with a day.`, details: { column, day } };
      else if (kind === 'time' && op === 'neq') problem = { message: `"${column}" keeps a time, so a day is a span on it: "neq" takes a date column only.`, details: { column, op, day } };
    }
  };
  for (const node of filters ?? []) walk(node, 0);
  if (problem !== null) return problem;
  if (conditions > MAX_FILTER_CONDITIONS) return { message: 'Filters are limited to 16 conditions.', details: { maxConditions: MAX_FILTER_CONDITIONS } };
  return null;
}
