// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `booking-occupancy` binding: how much of each person's working time was
 * booked, over the days the binding names, on a table with a booking rule.
 *
 * WHOLE OR LEFT OUT, as a team's figures are (`team-figures.ts`): the figure
 * is about everyone, so it is answered only to a reader no row limit holds on
 * any table it is worked out from, whose roles read each of them. Anybody else
 * is refused before a row is read: never a partial figure under the team's
 * heading. The calendar table Adminium keeps is not one of them: it is private,
 * and this figure does not read it.
 *
 * Shaped as `categorical` (an item a person, valued by their share), a
 * `record-list` (a line a person, with the team's line under `totals`), or a
 * KPI of the whole team.
 */
import type { Dialect } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';
import { sql, type Kysely } from 'kysely';

import type { TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { addDays } from '../crud/booking-guard.js';
import { bookingOccupancy, type OccupancyLine } from '../crud/booking-occupancy.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { labelColumnFor } from '../crud/labels.js';
import type { RowLimitContext } from '../crud/row-limit.js';
import { rowTestOf } from '../crud/row-limit-context.js';
import { venueClock } from '../crud/venue-time.js';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { ColumnMeta } from './shapers.js';
import { WholeOnlyError } from './team-figures.js';

export type ShapedOccupancy =
  | { shape: 'single-metric'; value: number | null }
  | { shape: 'categorical'; items: { key: string; label: string; value: number }[]; total: number; period: { from: string; to: string } }
  | { shape: 'record-list'; rows: Record<string, unknown>[]; columns: ColumnMeta[]; total: number; key: 'person'; totals: { booked: number; working: number; occupancy: number | null }; period: { from: string; to: string } };

const reject = (message: string, details?: unknown): never => {
  throw new ValidationFailedError(message, details);
};

const NOT_HERE = ['select', 'lookups', 'aggregations', 'groupBy', 'groupLabel', 'bucket', 'filters', 'window', 'orderBy', 'cursor', 'capacity', 'counts', 'people', 'daysSince', 'team'] as const;

const shareOf = (booked: number, working: number): number | null => (working > 0 ? booked / working : null);

/** Every table the figure is worked out from, by id. A calendar Adminium keeps is not read. */
function tablesRead(rule: TableBookingRule, table: ResolvedTable): string[] {
  return [
    ...new Set(
      [
        table.id,
        // Whose names the answer carries, whether or not the rule keeps its order there.
        table.table?.columns.find((column) => column.name === rule.resource)?.references?.tableId,
        rule.eligible.table,
        rule.eligible.order?.table,
        rule.hours.practice.table,
        rule.hours.own?.table,
        rule.closures?.table,
        ...(rule.busy ?? []).filter((source) => source.engine === undefined).map((source) => source.table),
      ].filter((id): id is string => id !== undefined),
    ),
  ];
}

export async function answerBookingOccupancy(input: {
  descriptor: QueryDescriptor;
  connectionId: string;
  /** The reader's view: a table or a column their roles do not show is refused by it. */
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  timezone: string | undefined;
  now: Date;
  reach: RowLimitContext | null;
  canReadTable: (tableId: string) => Promise<boolean>;
}): Promise<{ shaped: ShapedOccupancy; tables: string[] }> {
  const { descriptor, view, table, db, dialect } = input;
  const rule = table.table?.booking;
  if (rule === undefined) throw new NotFoundError('This table books no one.', { table: table.id });
  const shape = descriptor.shape;
  if (shape !== 'single-metric' && shape !== 'categorical' && shape !== 'record-list') {
    return reject('Booking occupancy is answered as a "single-metric", "categorical" or "record-list".', { shape });
  }
  for (const key of NOT_HERE) {
    if (descriptor[key] !== undefined) reject(`\`${key}\` has no meaning on a \`booking-occupancy\` binding.`, { [key]: descriptor[key] });
  }
  const asked = descriptor.occupancy ?? { days: 28, offset: 1 };
  if (asked.metric !== undefined && shape !== 'single-metric') reject('`metric` is the figure a KPI shows.', { metric: asked.metric });

  // WHOLE OR LEFT OUT: decided before a row is read, so the refusal says nothing else.
  const tables = tablesRead(rule, table);
  for (const id of tables) {
    if (!(await input.canReadTable(id))) throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission: `table:${input.connectionId}:${id}:read` });
  }
  if (tables.some((id) => rowTestOf(input.reach, id, 'read') !== null)) throw new WholeOnlyError();
  // A column this reader's roles hide is refused by name: the figure is read from it.
  for (const column of [rule.start, rule.minutes, rule.resource, rule.countWhere.column]) view.readableColumn(table, column, false);

  const zone = input.timezone ?? 'UTC';
  const today = venueClock(input.now, zone).day;
  const to = addDays(today, -asked.offset);
  const from = addDays(to, -(asked.days - 1));
  const lines = await bookingOccupancy(rule, { connectionId: input.connectionId, table, db, dialect, timezone: zone }, { from, to, states: asked.states });

  const booked = lines.reduce((sum, line) => sum + line.booked, 0);
  const working = lines.reduce((sum, line) => sum + line.working, 0);
  if (shape === 'single-metric') {
    const metric = asked.metric ?? 'occupancy';
    return { shaped: { shape, value: metric === 'booked' ? booked : metric === 'working' ? working : shareOf(booked, working) }, tables };
  }
  const names = await namesOf(view, table, db, rule, lines);
  const period = { from, to };
  if (shape === 'categorical') {
    const items = lines.map((line) => ({ key: line.resource, label: names.get(line.resource) ?? line.resource, value: shareOf(line.booked, line.working) ?? 0 }));
    return { shaped: { shape, items, total: shareOf(booked, working) ?? 0, period }, tables };
  }
  const number = (name: string, logicalType = 'integer'): ColumnMeta => ({ name, logicalType, nullable: true, isPrimaryKey: false });
  return {
    shaped: {
      shape,
      rows: lines.map((line) => ({ person: line.resource, name: names.get(line.resource) ?? line.resource, booked: line.booked, working: line.working, occupancy: shareOf(line.booked, line.working) })),
      columns: [{ name: 'name', logicalType: 'varchar', nullable: false, isPrimaryKey: false }, number('booked'), number('working'), number('occupancy', 'decimal')],
      total: lines.length,
      key: 'person',
      totals: { booked, working, occupancy: shareOf(booked, working) },
      period,
    },
    tables,
  };
}

/** What each person is called: the display column of the table the rule's resource points at, where this reader sees it. */
async function namesOf(view: SnapshotView, table: ResolvedTable, db: Kysely<SourceDatabase>, rule: TableBookingRule, lines: readonly OccupancyLine[]): Promise<Map<string, string>> {
  const link = table.table?.columns.find((column) => column.name === rule.resource)?.references;
  if (link === undefined || link === null || lines.length === 0) return new Map();
  const people = view.linkTable(link.tableId);
  const label = people === null ? null : labelColumnFor(view, people);
  if (people === null || label === null) return new Map();
  const rows = (await db
    .selectFrom(people.id)
    .select([sql`${db.dynamic.ref(link.column)}`.as('k'), sql`${db.dynamic.ref(label)}`.as('l')])
    .execute()) as { k: unknown; l: unknown }[];
  return new Map(rows.filter((row) => row.l !== null && row.l !== undefined && String(row.l) !== '').map((row) => [String(row.k), String(row.l)]));
}
