// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column whose earlier values only the audit log keeps (`column.history:
 * "audit"`), at the two places a row as it was leaves the server outside
 * record history (offline units, no database): the live frame of a removed
 * row, and what a rule run by a change keeps of the row as it was for
 * `{{was.<column>}}`. The value a row holds now is sent as ever. Record
 * history, a removed row's history and the audit page are proved on three
 * engines in `removal-history.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { triggerEventFor } from '../src/automations/matcher.js';
import { opsForRules, tableOpsFor } from '../src/apps/manifest-rules.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { RealtimeHub, widgetDataChannel, type RealtimeEvent } from '../src/realtime/hub.js';
import { publishWidgetDataStream } from '../src/widget-data/stream-publisher.js';

const model = (history: boolean) =>
  ({
    dialect: 'postgres',
    name: 'unit',
    defaultSchema: 'public',
    schemas: ['public'],
    enums: [],
    relations: [],
    tables: [
      {
        id: 'public.messages',
        schema: 'public',
        name: 'messages',
        kind: 'table',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, semantics: null },
          { name: 'text', logicalType: 'text', nullable: true, isPrimaryKey: false, semantics: null, ...(history ? { history: 'audit' } : {}) },
          { name: 'state', logicalType: 'varchar', nullable: false, isPrimaryKey: false, semantics: null },
        ],
      },
    ],
  }) as unknown as EffectiveModel;

const messages = (history: boolean) => new SnapshotView('conn_1', model(history)).table('public.messages');

function capture(): { hub: RealtimeHub; seen: RealtimeEvent[] } {
  const hub = new RealtimeHub();
  const seen: RealtimeEvent[] = [];
  hub.subscribe(widgetDataChannel('conn_1', 'public.messages'), (event) => seen.push(event));
  return { hub, seen };
}

describe('column.history "audit" in a live frame', () => {
  it('a removed row\'s frame carries the row as it was without the column', () => {
    const { hub, seen } = capture();
    publishWidgetDataStream(hub, { connectionId: 'conn_1', table: messages(true), type: 'record.delete', pk: { id: 7 }, row: { id: 7, text: 'Meet at the hotel bar', state: 'live' } });
    expect(seen[0]?.data).toEqual({ type: 'record.delete', pk: { id: 7 }, row: { id: 7, state: 'live' } });
  });

  it('a change\'s frame carries the value the row holds now, as ever', () => {
    const { hub, seen } = capture();
    publishWidgetDataStream(hub, { connectionId: 'conn_1', table: messages(true), type: 'record.update', pk: { id: 7 }, row: { id: 7, text: null, state: 'removed' }, before: { id: 7, text: 'Meet at the hotel bar', state: 'live' } });
    expect(seen[0]?.data).toEqual({ type: 'record.update', pk: { id: 7 }, row: { id: 7, text: null, state: 'removed' } });
    // Nothing of the row as it was goes on the wire.
    expect(JSON.stringify(seen[0])).not.toContain('hotel bar');
  });

  it('a column without the rule is sent as it always was', () => {
    const { hub, seen } = capture();
    publishWidgetDataStream(hub, { connectionId: 'conn_1', table: messages(false), type: 'record.delete', pk: { id: 7 }, row: { id: 7, text: 'Meet at the hotel bar', state: 'live' } });
    expect(seen[0]?.data).toEqual({ type: 'record.delete', pk: { id: 7 }, row: { id: 7, text: 'Meet at the hotel bar', state: 'live' } });
  });
});

describe('column.history "audit" in a rule\'s {{was.<column>}}', () => {
  const event = (history: boolean) => ({
    connectionId: 'conn_1',
    table: messages(history),
    action: 'update' as const,
    entity: { connectionId: 'conn_1', table: 'public.messages', pk: { id: 7 }, label: '7' },
    before: { id: 7, text: 'Meet at the hotel bar', state: 'live' },
    after: { id: 7, text: null, state: 'removed' },
    origin: 'dashboard' as const,
  });

  it('a run keeps nothing of the column as it was, only the other columns it reads', () => {
    const kept = triggerEventFor(event(true), 0, event(true).after, new Set(['text', 'state']));
    expect(kept.before).toEqual({ state: 'live' });
    expect(JSON.stringify(kept)).not.toContain('hotel bar');
  });

  it('a run that reads only that column keeps no row as it was at all', () => {
    expect(triggerEventFor(event(true), 0, event(true).after, new Set(['text'])).before).toBeUndefined();
  });

  it('without the rule, the column as it was is kept as ever', () => {
    expect(triggerEventFor(event(false), 0, event(false).after, new Set(['text', 'state'])).before).toEqual({ text: 'Meet at the hotel bar', state: 'live' });
  });
});

describe('the words, as an app\'s install stores them and the server reads them back', () => {
  it('a table\'s removal rule and a column\'s history rule are each one rule, read back as written', () => {
    expect(tableOpsFor({ removal: { reason: 'required', history: true } })).toEqual([{ op: 'table.removal', value: { reason: 'required', history: true } }]);
    expect(opsForRules('firm', { history: 'audit' })).toEqual([{ op: 'column.history', value: { history: 'audit' } }]);
    const stored = (op: string, value: Record<string, unknown>, columnName: string | null = null) => ({ id: op, connectionId: 'conn_1', op, tableName: 'public.messages', columnName, value, origin: 'app', llmRunId: null, status: 'active', createdBy: null, createdAt: 1, updatedAt: 1 });
    const read = applyOverrides(model(false) as never, [stored('table.removal', { reason: true, history: true }), stored('column.history', { history: 'audit' }, 'text')] as never);
    const table = read.tables.find((one) => one.id === 'public.messages')!;
    expect(table.removal).toEqual({ reason: true, history: true });
    expect(table.columns.find((column) => column.name === 'text')?.history).toBe('audit');
    expect(table.columns.find((column) => column.name === 'state')?.history).toBeUndefined();
  });
});
