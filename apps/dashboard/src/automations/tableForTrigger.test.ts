// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which table a rule is about (42-automations-and-workflow-logs.md D25's
 * residual): resolved inside the rule's OWN connection. A flat search across
 * every connection returns whichever holds that `schema.table` first, so the
 * inspector showed one connection's columns for the other's rows.
 */
import { describe, expect, it } from 'vitest';

import { connectionForTrigger, tableForTrigger, type SourceConnection, type SourceTable, type Sources } from './api.js';
import type { Trigger } from './model/graph.js';

function table(id: string, label: string, columns: string[] = []): SourceTable {
  return {
    id,
    label,
    canRead: true,
    canCreate: true,
    canUpdate: true,
    watch: { created: 'created_at', updated: 'updated_at' },
    columns: columns.map((name) => ({
      name,
      label: name,
      logicalType: 'varchar',
      isPk: false,
      pii: false,
      emailLike: false,
      dateLike: false,
    })),
    children: [],
    pageSlug: null,
  };
}

function connection(id: string, name: string, tables: SourceTable[]): SourceConnection {
  return { id, name, dialect: 'sqlite', timezone: 'UTC', tables };
}

// Both connections hold `main.orders`, with different columns.
const SOURCES: Sources = {
  connections: [
    connection('cnx_1', 'Northwind', [table('main.orders', 'orders', ['ship_city'])]),
    connection('cnx_2', 'Billing', [table('main.orders', 'orders', ['amount_due'])]),
  ],
  templates: [],
  roles: [],
};

const RECORD = (over: Partial<Extract<Trigger, { kind: 'record' }>> = {}): Trigger => ({
  kind: 'record',
  event: 'created',
  connectionId: 'cnx_1',
  table: 'main.orders',
  watch: false,
  ...over,
});

describe('tableForTrigger', () => {
  it('reads the rule’s own connection, not the first one holding the name', () => {
    expect(tableForTrigger(SOURCES, RECORD())?.columns.map((c) => c.name)).toEqual(['ship_city']);
    expect(
      tableForTrigger(SOURCES, RECORD({ connectionId: 'cnx_2' }))?.columns.map((c) => c.name),
    ).toEqual(['amount_due']);
  });

  it('is null before a table is picked', () => {
    expect(tableForTrigger(SOURCES, RECORD({ table: '' }))).toBeNull();
    expect(tableForTrigger(SOURCES, null)).toBeNull();
    expect(tableForTrigger(null, RECORD())).toBeNull();
  });

  it('is null when the connection does not hold that table', () => {
    expect(tableForTrigger(SOURCES, RECORD({ table: 'main.missing' }))).toBeNull();
  });

  it('follows a schedule’s for-each target', () => {
    const schedule: Trigger = {
      kind: 'schedule',
      connectionId: 'cnx_2',
      schedule: { kind: 'interval', everyMinutes: '15' },
      forEach: { table: 'main.orders', where: [], once: true },
    };
    expect(tableForTrigger(SOURCES, schedule)?.columns.map((c) => c.name)).toEqual(['amount_due']);
  });

  it('a bare schedule has no table, and falls back to the first connection', () => {
    const bare: Trigger = {
      kind: 'schedule',
      connectionId: null,
      schedule: { kind: 'interval', everyMinutes: '15' },
    };
    expect(tableForTrigger(SOURCES, bare)).toBeNull();
    // …which is the connection its for-each picker offers, so the two agree.
    expect(connectionForTrigger(SOURCES, bare)?.id).toBe('cnx_1');
  });
});
