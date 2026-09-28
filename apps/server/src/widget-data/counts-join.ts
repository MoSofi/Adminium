// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIST'S ROWS WITH WHAT A LIMIT HAS TAKEN FROM EACH (`counts` on a
 * `record-list`): the coming shows with their tickets sold and held of what
 * each can sell; the ticket types of a show with theirs; the room types with
 * tonight's rooms taken.
 *
 * The rows are a table query's — filtered, windowed, put in order and
 * limited like any other list — and must be the limit's pools: the rows its
 * key points at (the ticket types), the rows one of its `also` pools points
 * at (the events), or a night limit's pools (the room types). Each gets
 * `{ taken, held, size, left }` under `as`, counted as the desk's counts
 * count (staff's view: a place kept back for a waitlist is not taken), on
 * the day the page's day control names, else the binding's `date`, else
 * today on the venue's clock — where the limit counts by day or night.
 *
 * Read rules: the counts route's. The reader must read the limited table and
 * every table its pools are kept in (403 `TABLE_FORBIDDEN`), and every column
 * the rule is made of (403, as a masked column), as the route asks. A row whose key the reader cannot see (masked) gets no counts.
 */
import { type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { addDays } from '../crud/capacity/count.js';
import type { CountsAccess } from '../crud/capacity/counts.js';
import { capacityState, tallyFor } from '../crud/capacity/judge.js';
import { rulesFor } from '../crud/capacity/rules.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { refuseHiddenIn } from '../crud/read-view.js';
import { venueClock } from '../crud/venue-time.js';
import type { WriteTarget } from '../crud/write-context.js';
import type { ColumnMeta } from './shapers.js';

export interface CountsCell {
  taken: number;
  held: number;
  /** Null: no limit. */
  size: number | null;
  left: number | null;
}

function reject(message: string, details: unknown = {}): never {
  throw new ValidationFailedError(message, details);
}

/** The day a page's day control names, on the venue's calendar; null for none it can show. */
function dayNamed(value: unknown, today: string): string | 'week' | null {
  if (value === 'today') return today;
  if (value === 'yesterday') return addDays(today, -1);
  if (value === 'week') return 'week';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return value;
  return null;
}

/** The limited table a `counts` names, and the other tables whose writes move its answer. */
export function countsTablesOf(view: SnapshotView, descriptor: QueryDescriptor): string[] {
  if (descriptor.counts === undefined) return [];
  return limitTablesOf(view, view.table(descriptor.counts.table));
}

/**
 * Every table a write to which moves what a table's limits count: the table
 * itself, the rows its pools are kept on (ticket types, events, room types),
 * the rooms a night pool counts and their closures, the row a condition or a
 * hold is read through (the order), a hold's end one link further (the
 * waitlist offer), and a setting a size is read from. A cached answer over the
 * counts is dropped by a write to any of them.
 */
export function limitTablesOf(view: SnapshotView, limited: ResolvedTable): string[] {
  const out = new Set<string>([limited.id]);
  const add = (id: string | undefined) => {
    if (id === undefined) return;
    const table = view.linkTable(id);
    out.add(table?.id ?? id);
  };
  const size = (value: { kind: string; setting?: { table: string }; link?: { table: ResolvedTable } | null }) => {
    if (value.kind === 'setting') add(value.setting?.table);
    if (value.kind === 'hop') add(value.link?.table.id);
  };
  for (const rule of rulesFor(view, limited)) {
    add(rule.owner?.table.id);
    for (const end of rule.hold?.ends ?? []) add(end.link?.table.id);
    if (rule.kind === 'slot') {
      const perSlot = rule.rule.perSlot as unknown;
      if (typeof perSlot === 'object' && perSlot !== null && 'table' in perSlot) add(String((perSlot as { table: unknown }).table));
      continue;
    }
    add(rule.via?.table.id);
    if (rule.kind === 'parent') {
      size(rule.size);
      for (const wider of rule.also) {
        add(wider.via?.table.id);
        size(wider.size);
      }
      continue;
    }
    if (rule.pool.kind === 'count') add(rule.pool.table);
    else size(rule.pool.size);
    add(rule.outOfService?.table);
    add(rule.given?.via?.table.id);
  }
  return [...out];
}

export async function joinCounts(input: {
  descriptor: QueryDescriptor;
  params: Record<string, unknown>;
  connectionId: string;
  view: SnapshotView;
  /** The list's table. */
  source: ResolvedTable;
  rows: readonly Row[];
  columns: readonly ColumnMeta[];
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  timezone: string | undefined;
  now: Date;
  access: CountsAccess;
}): Promise<{ rows: Row[]; columns: ColumnMeta[] }> {
  const counts = input.descriptor.counts;
  if (counts === undefined) return { rows: [...input.rows], columns: [...input.columns] };
  const { view, source } = input;
  if (input.columns.some((column) => column.name === counts.as) || input.rows.some((row) => Object.prototype.hasOwnProperty.call(row, counts.as))) {
    reject(`The counts go under "${counts.as}", which this list already has: name them otherwise (\`as\`).`, { as: counts.as });
  }
  const limited = view.table(counts.table); // 422 unknown
  // The limited table's read: asked first, as the counts route's own table read is.
  await input.access.table(limited.id);
  if ((limited.table?.capacityRules?.length ?? 0) === 0) reject('This table keeps no limit.', { table: limited.id });
  const rule = rulesFor(view, limited)[counts.rule];
  if (rule === undefined) reject('This table has no such limit.', { rule: counts.rule });
  // Made of the rule's own columns: refused to a role that may not read one, as the counts themselves are.
  refuseHiddenIn(view, limited.table?.capacityRules?.[counts.rule]);
  if (rule.kind === 'slot') reject('A slot limit counts slots, not rows of a list: bind its counts to a strip instead.', { rule: counts.rule });

  // Which of the limit's pools the list's rows are.
  let part: string;
  let key: string;
  if (rule.via !== null && rule.via.table.id === source.id) {
    part = rule.kind === 'parent' ? 'p' : 'n';
    key = rule.via.key;
  } else {
    const wider = rule.kind === 'parent' ? rule.also.find((pool) => pool.via !== null && pool.via.table.id === source.id) : undefined;
    if (wider === undefined || wider.via === null) {
      reject("This list's rows are not what that limit counts: list its pools, or the pools it also takes from.", { table: source.id, counts: limited.id });
    }
    part = wider.part;
    key = wider.via.key;
  }
  // Every table the pools are kept in, as the counts route asks.
  if (rule.via !== null) await input.access.table(rule.via.table.id);
  if (rule.kind === 'parent') for (const wider of rule.also) if (wider.via !== null) await input.access.table(wider.via.table.id);
  if (rule.kind === 'night') {
    if (rule.pool.kind === 'count') await input.access.table(view.table(rule.pool.table).id);
    if (rule.outOfService !== null) await input.access.table(view.table(rule.outOfService.table).id);
  }
  if (!input.columns.some((column) => column.name === key)) {
    reject(`The counts are matched to each row by "${key}": the list must select it.`, { select: key });
  }

  // The day: where the limit counts by day (or night).
  const zone = input.timezone ?? 'UTC';
  const today = venueClock(input.now, zone).day;
  const followed = input.params[counts.param];
  const named = followed === undefined ? (counts.date ?? today) : dayNamed(followed, today);
  const byDay = rule.kind === 'night' || rule.day !== null;
  if (byDay && (named === null || named === 'week')) {
    reject(named === null ? 'The day asked for is not one this page can show.' : 'These counts are for one day or night at a time.', { day: followed });
  }
  const day = byDay ? (named as string) : undefined;

  const keyText = (row: Row): string | null => {
    const value = row[key];
    return value === null || value === undefined || value === '' ? null : String(value);
  };
  const keys = [...new Set(input.rows.map(keyText).filter((value): value is string => value !== null))];
  const target: WriteTarget = { connectionId: input.connectionId, view, table: limited, db: input.db, dialect: input.dialect, timezone: zone };
  const found = new Map<string, CountsCell>();
  if (keys.length > 0) {
    const states =
      part === 'p' || part === 'n'
        ? await capacityState(input.db, target, { rule: counts.rule, keys, ...(day === undefined ? {} : part === 'n' ? { from: day, to: addDays(day, 1) } : { day }) }, input.now)
        : await tallyFor(input.db, target, rule, keys.map((k) => ({ part, key: k, at: day })), input.now, [], 'staff');
    for (const state of states) {
      const left = state.size === null ? null : state.size - state.taken;
      found.set(state.key, { taken: state.taken, held: state.held, size: state.size, left });
    }
  }
  return {
    rows: input.rows.map((row) => {
      const k = keyText(row);
      return { ...row, [counts.as]: k === null ? null : (found.get(k) ?? null) };
    }),
    columns: [...input.columns, { name: counts.as, logicalType: 'json', nullable: true, isPrimaryKey: false, semantic: 'capacity-bar' }],
  };
}
