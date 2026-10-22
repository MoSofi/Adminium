// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A code no staff member reads (`code.hiddenFromStaff`, an order's own link)
 * is no placeholder of a rule: a rule's text reaches whoever its author says,
 * and a run would leave it as written. The rule is refused when it is saved,
 * the column named — as the record's (`{{record.x}}`, `{{x}}`, `{{was.x}}`)
 * and as a linked row's (`{{link.x}}`, `{{record.link.x}}`). No database: the
 * save's checks read the snapshot only.
 */
import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { resolveRule } from '../src/automations/validate.js';

const column = (name: string, i: number) => ({
  name,
  ordinal: i + 1,
  dbType: name === 'id' || name === 'order_id' ? 'integer' : 'text',
  logicalType: name === 'id' || name === 'order_id' ? 'integer' : 'text',
  nullable: name !== 'id',
  default: null,
  isPrimaryKey: name === 'id',
  isUnique: false,
  isGenerated: false,
  enumRef: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  isArray: false,
  comment: null,
  references: null,
  semantics: { primary: 'plain', flags: { secret: false, pii: null, maskedByDefault: false }, format: null, pair: null, confidence: 0.5, source: 'heuristic' },
});

const model = () => ({
  irVersion: 1,
  dialect: 'postgres',
  source: { kind: 'live', connectionId: 'c' },
  name: 'c',
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    { id: 'public.orders', schema: 'public', name: 'orders', kind: 'table', comment: null, primaryKey: ['id'], columns: [column('id', 0), column('status', 1), column('share_code', 2)] },
    { id: 'public.notes', schema: 'public', name: 'notes', kind: 'table', comment: null, primaryKey: ['id'], columns: [column('id', 0), column('order_id', 1), column('text', 2)] },
  ],
  relations: [{ id: 'r1', kind: 'declared-fk', name: null, from: { tableId: 'public.notes', columns: ['order_id'] }, to: { tableId: 'public.orders', columns: ['id'] }, cardinality: 'many-to-one', through: null, onDelete: null, onUpdate: null, confidence: 1, source: 'introspection' }],
  enums: [],
});

const hidden = { id: 'ovr_1', connectionId: 'c', op: 'column.code', tableName: 'public.orders', columnName: 'share_code', value: { length: 16, hiddenFromStaff: true }, origin: 'app', status: 'active', llmRunId: null, createdAt: 1, updatedAt: 1 };
const view = new SnapshotView('c', applyOverrides(model() as never, [hidden as never]));

const notice = (table: string, body: string, event = 'updated') =>
  resolveRule(
    { kind: 'record', connectionId: 'c', table, event } as never,
    { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Tell', onError: false, action: { kind: 'notification', to: { roles: ['admin'] }, title: 'Order', body } }] } as never,
    { view, templateKeys: new Set(), blockLoopback: true },
  );

describe('a rule never carries a code staff never see', () => {
  it('reads the record\'s other columns, and a linked row\'s', () => {
    expect(() => notice('public.orders', 'Order is {{record.status}}')).not.toThrow();
    expect(() => notice('public.notes', 'About {{order_id.status}}')).not.toThrow();
  });

  it('is refused at the save for the record\'s code, in each way of naming it', () => {
    for (const name of ['record.share_code', 'share_code', 'was.share_code']) {
      expect(() => notice('public.orders', `Code {{${name}}}`)).toThrow(`Step “Tell”: {{${name}}} reads orders.share_code, a code staff never see, and a rule never carries it.`);
    }
  });

  it('is refused for a linked row\'s code', () => {
    for (const name of ['order_id.share_code', 'record.order_id.share_code']) {
      expect(() => notice('public.notes', `Code {{${name}}}`)).toThrow(`{{${name}}} reads orders.share_code`);
    }
  });
});
