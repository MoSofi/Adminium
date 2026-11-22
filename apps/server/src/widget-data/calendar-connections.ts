// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `calendar-connections` binding: how many people of a table have a
 * connected calendar, by state. Whole or left out, as a team's figures are: it
 * is about everyone, so a reader a row limit holds is refused rather than told
 * a count of the people they happen to reach.
 */
import type { QueryDescriptor } from '@adminium/engine/config';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { RowLimitContext } from '../crud/row-limit.js';
import { rowTestOf } from '../crud/row-limit-context.js';
import { ValidationFailedError } from '../errors.js';
import { WholeOnlyError } from './team-figures.js';

export interface CalendarConnectionCounts {
  connected: number;
  reconnect: number;
  connecting: number;
  partial: number;
  notConnected: number;
}

export type ShapedConnections =
  | { shape: 'single-metric'; value: number }
  | { shape: 'categorical'; items: { key: string; label: string; value: number }[]; total: number };

const NOT_HERE = ['select', 'lookups', 'aggregations', 'groupBy', 'groupLabel', 'bucket', 'filters', 'window', 'orderBy', 'cursor', 'capacity', 'counts', 'people', 'daysSince', 'team', 'occupancy'] as const;

export async function answerCalendarConnections(input: {
  descriptor: QueryDescriptor;
  connectionId: string;
  table: ResolvedTable;
  reach: RowLimitContext | null;
  counts: (connectionId: string, tableId: string) => Promise<CalendarConnectionCounts | null>;
}): Promise<ShapedConnections> {
  const { descriptor, table } = input;
  if (descriptor.shape !== 'single-metric' && descriptor.shape !== 'categorical') {
    throw new ValidationFailedError('Calendar connections are answered as a "single-metric" or "categorical".', { shape: descriptor.shape });
  }
  for (const key of NOT_HERE) {
    if (descriptor[key] !== undefined) throw new ValidationFailedError(`\`${key}\` has no meaning on a \`calendar-connections\` binding.`, { [key]: descriptor[key] });
  }
  if (rowTestOf(input.reach, table.id, 'read') !== null) throw new WholeOnlyError();
  const held = await input.counts(input.connectionId, table.id);
  if (held === null) throw new ValidationFailedError('This table\'s rows do not connect a calendar.', { table: table.id });
  if (descriptor.shape === 'single-metric') return { shape: 'single-metric', value: held.connected };
  // The words are the card's: these keys are what it translates.
  const items = [
    { key: 'connected', label: 'connected', value: held.connected },
    { key: 'reconnect', label: 'reconnect', value: held.reconnect },
    { key: 'connecting', label: 'connecting', value: held.connecting },
    { key: 'partial', label: 'partial', value: held.partial },
    { key: 'not-connected', label: 'not-connected', value: held.notConnected },
  ];
  return { shape: 'categorical', items, total: items.reduce((sum, item) => sum + item.value, 0) };
}
