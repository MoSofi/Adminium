// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `capacity-counts` binding: a table limit's counts as a widget reads them —
 * the desk's route (`GET /data/:conn/:table/capacity-counts`) answered for a
 * card, on exactly that route's read rules:
 *
 * - the limited table's read grant (asked by the widget-data route before
 *   this runs, as for every binding, with its denial audited);
 * - the pools' tables' read grants, and a column asked `under` only where the
 *   reader sees it unmasked — the counts ask these themselves, through the
 *   {@link countsAccessFor} the route builds from the request, which answers
 *   as the data route's does (403 `TABLE_FORBIDDEN` / `COLUMN_FORBIDDEN`).
 *
 * The day: a slot limit counts the day the page's day control names (its
 * `week` is the week from Monday, day by day), else the binding's own `date`,
 * else today on the venue's clock. Shaped as `categorical` (an item per slot,
 * day or pool, valued by what is taken) or `record-list` (a row per slot, day
 * or pool, as the route answers it, a pool's row with its label), each with a
 * `capacity` block a strip reads: the kind, the day, the venue's clock now,
 * whether the day is closed, and the route's rows.
 */
import type { FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';

import { ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { addDays } from '../crud/capacity/count.js';
import { capacityCounts, type CountsAccess, type CountsAsk } from '../crud/capacity/counts.js';
import { rulesFor } from '../crud/capacity/rules.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { labelColumnFor } from '../crud/labels.js';
import { canReadPii, type Row } from '../crud/mask.js';
import { venueClock } from '../crud/venue-time.js';
import type { ColumnMeta } from './shapers.js';

/** The reply's rows are the route's: a slot's, a day's, a pool's or a night's counts. */
export type CountsRow = Record<string, unknown>;

export interface CapacityBlock {
  kind: 'slot' | 'parent' | 'night';
  /** The day counted, or the first of the days a strip counts. */
  date: string | null;
  /** How many days: 1, or 7 for the day control's week. */
  days: number;
  /** The venue's clock when the answer was made: its day and minute of the day. */
  now: { day: string; minute: number };
  /** The day counted is closed (a slot limit): no one may take its slots. */
  closed: boolean;
  rows: CountsRow[];
}

export interface ShapedCapacityCategorical {
  shape: 'categorical';
  items: { key: string; label: string; value: number }[];
  total: number;
  capacity: CapacityBlock;
}

export interface ShapedCapacityRecordList {
  shape: 'record-list';
  rows: Row[];
  columns: ColumnMeta[];
  total: number;
  capacity: CapacityBlock;
}

export type ShapedCapacity = ShapedCapacityCategorical | ShapedCapacityRecordList;

/**
 * What the reader may read beyond the limited table — the data route's
 * `access` for the same counts, made from this request.
 */
export function countsAccessFor(request: FastifyRequest, connectionId: string, view: SnapshotView): CountsAccess {
  return {
    table: async (tableId: string) => {
      const permission = `table:${connectionId}:${tableId}:read`;
      if (!(await request.can(permission))) throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission });
    },
    column: async (table: ResolvedTable, name: string) => {
      view.readableColumn(table, name, await canReadPii(request, connectionId, table.id));
    },
  };
}

function reject(message: string, details: unknown = {}): never {
  throw new ValidationFailedError(message, details);
}

/** Table-query parts a counts binding has no use for: refused by name, never ignored. */
const TABLE_QUERY_PARTS = ['select', 'lookups', 'aggregations', 'groupBy', 'groupLabel', 'bucket', 'filters', 'window', 'orderBy', 'cursor'] as const;

/** The day (or the week) a page's day control names, on the venue's calendar. */
function daysAsked(value: unknown, today: string): { from: string; days: number } | null {
  if (value === 'today') return { from: today, days: 1 };
  if (value === 'yesterday') return { from: addDays(today, -1), days: 1 };
  if (value === 'week') {
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
    return { from: addDays(today, -weekday), days: 7 };
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return { from: value, days: 1 };
  return null;
}

export async function answerCapacityCounts(input: {
  descriptor: QueryDescriptor;
  params: Record<string, unknown>;
  connectionId: string;
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  timezone: string | undefined;
  now: Date;
  access: CountsAccess;
  /** Whether the reader sees a table's personal columns (a pool's label). */
  canReadPii: (tableId: string) => Promise<boolean>;
}): Promise<ShapedCapacity> {
  const { descriptor, table, view, db } = input;
  if (descriptor.shape !== 'categorical' && descriptor.shape !== 'record-list') {
    reject(`A limit's counts are answered as "categorical" or "record-list", not "${descriptor.shape}".`, { shape: descriptor.shape });
  }
  for (const part of TABLE_QUERY_PARTS) {
    if (descriptor[part] !== undefined) reject(`A \`capacity-counts\` binding takes no \`${part}\`: it counts the limit, it does not query the table.`, { [part]: descriptor[part] });
  }
  if ((table.table?.capacityRules?.length ?? 0) === 0) throw new NotFoundError('This table keeps no limit.', { table: table.id });
  const capacity = descriptor.capacity ?? { rule: 0, param: 'day' };
  const zone = input.timezone ?? 'UTC';
  const clock = venueClock(input.now, zone);
  const rule = rulesFor(view, table)[capacity.rule];
  if (rule === undefined) reject('This table has no such limit.', { rule: capacity.rule });

  // The day control's day, else the binding's own, else today.
  const followed = input.params[capacity.param];
  const asked = followed !== undefined ? daysAsked(followed, clock.day) : { from: capacity.date ?? clock.day, days: 1 };
  if (asked === null) reject('The day asked for is not one this page can show.', { day: followed });

  const ask: CountsAsk = {
    rule: capacity.rule,
    ...(capacity.under === undefined ? {} : { under: capacity.under }),
    ...(capacity.value === undefined ? {} : { value: capacity.value }),
    ...(capacity.ids === undefined ? {} : { ids: capacity.ids }),
  };
  if (rule.kind === 'slot') {
    Object.assign(ask, asked.days === 1 ? { date: asked.from } : { from: asked.from, days: asked.days });
  } else if (rule.kind === 'parent') {
    if (rule.day !== null) {
      if (asked.days !== 1) reject('This limit counts one day at a time.', { day: followed });
      ask.date = asked.from;
    }
  } else {
    Object.assign(ask, { from: asked.from, days: asked.days });
  }

  const answer = await capacityCounts(
    { connectionId: input.connectionId, view, table, db, dialect: input.dialect, timezone: zone },
    ask,
    input.now,
    input.access,
  );
  if (!answer.ok) reject(answer.message);
  const rows = answer.data.rows;

  // What a pool is called: a column of its row, read as the reader may (never the reason the card fails).
  const labels = rule.kind === 'slot' || rule.via === null ? new Map<string, string>() : await poolLabels(input, rule.via.table, rule.via.key, rows, capacity.label);
  const keyOf = (row: CountsRow): string => String(row['time'] ?? row['id'] ?? (row['pool'] === undefined ? row['date'] : `${String(row['pool'])}|${String(row['date'])}`));
  const labelOf = (row: CountsRow): string => {
    if (rule.kind === 'slot') return String(row['time'] ?? row['date']);
    const pool = String(row['id'] ?? row['pool']);
    const name = labels.get(pool) ?? pool;
    return rule.kind === 'night' ? `${name} · ${String(row['date'])}` : name;
  };
  const block: CapacityBlock = {
    kind: answer.data.kind,
    date: rule.kind === 'parent' && rule.day === null ? null : asked.from,
    days: rule.kind === 'parent' ? 1 : asked.days,
    now: { day: clock.day, minute: clock.minute },
    closed: rule.kind === 'slot' && asked.days === 1 && rows.some((row) => row['closed'] === true),
    rows,
  };
  const taken = (row: CountsRow) => (typeof row['taken'] === 'number' ? row['taken'] : Number(row['taken'] ?? 0));

  if (descriptor.shape === 'categorical') {
    const items = rows.map((row) => ({ key: keyOf(row), label: labelOf(row), value: taken(row) }));
    return { shape: 'categorical', items, total: items.reduce((sum, item) => sum + item.value, 0), capacity: block };
  }
  const listed = rows.map((row) => (rule.kind === 'slot' ? { ...row } : { ...row, label: labelOf(row) }));
  return { shape: 'record-list', rows: listed, columns: countsColumns(rule.kind, asked.days), total: listed.length, capacity: block };
}

/** The columns a counts list names: its label (or slot, or day), then what is left or taken. */
function countsColumns(kind: 'slot' | 'parent' | 'night', days: number): ColumnMeta[] {
  const column = (name: string, logicalType: string, semantic?: string): ColumnMeta => ({
    name,
    logicalType,
    nullable: true,
    isPrimaryKey: false,
    ...(semantic === undefined ? {} : { semantic }),
  });
  if (kind === 'slot') return [column(days === 1 ? 'time' : 'date', days === 1 ? 'varchar' : 'date'), column('taken', 'integer'), column('size', 'integer')];
  return [column('label', 'varchar'), column('left', 'integer', 'capacity-left')];
}

/** Each pool's label: the binding's column, else the pool table's display column; a masked one reads only for a reader who sees it. */
async function poolLabels(
  input: { view: SnapshotView; db: Kysely<SourceDatabase>; canReadPii: (tableId: string) => Promise<boolean> },
  pools: ResolvedTable,
  key: string,
  rows: readonly CountsRow[],
  named: string | undefined,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row['id'] ?? row['pool']).filter((id) => id !== undefined && id !== null).map(String))];
  if (ids.length === 0) return new Map();
  let column: string | null;
  if (named === undefined) {
    column = labelColumnFor(input.view, pools);
  } else {
    const resolved = input.view.column(pools, named); // 422 unknown or secret
    column = resolved.masked && !(await input.canReadPii(pools.id)) ? null : resolved.name;
  }
  if (column === null) return new Map();
  const dynamic = input.db.dynamic;
  const found = (await input.db
    .selectFrom(pools.id)
    .select([sql`${dynamic.ref(key)}`.as('k'), sql`${dynamic.ref(column)}`.as('l')])
    .where(dynamic.ref(key), 'in', ids)
    .execute()) as { k: unknown; l: unknown }[];
  return new Map(found.filter((row) => row.l !== null && row.l !== undefined && String(row.l) !== '').map((row) => [String(row.k), String(row.l)]));
}
