// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule never writes a state only a move marked `undo` reaches: that move is
 * a person's, naming the state they saw, and a rule names none — so the step
 * would be refused on every run. The rule is refused when it is saved.
 */
import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { resolveRule } from '../src/automations/validate.js';

const column = (name: string, i: number, enumRef: string | null = null) => ({
  name,
  ordinal: i + 1,
  dbType: 'text',
  logicalType: enumRef === null ? 'text' : 'enum',
  nullable: true,
  default: null,
  isPrimaryKey: name === 'id',
  isUnique: false,
  isGenerated: false,
  enumRef,
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
  tables: [{ id: 'public.orders', schema: 'public', name: 'orders', kind: 'table', comment: null, primaryKey: ['id'], columns: [column('id', 0), column('status', 1)] }],
  relations: [],
  enums: [],
});

const states = { column: 'status', initial: 'preparing', moves: { preparing: ['ready'], ready: [{ to: 'preparing', undo: true }, 'collected'] } };
const view = new SnapshotView(
  'c',
  applyOverrides(model() as never, [{ id: 'ovr_1', connectionId: 'c', op: 'table.states', tableName: 'public.orders', columnName: null, value: states, origin: 'app', status: 'active', llmRunId: null, createdAt: 1, updatedAt: 1 } as never]),
);
const rule = (status: string) =>
  resolveRule(
    { kind: 'record', connectionId: 'c', table: 'public.orders', event: 'record.updated' } as never,
    { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Move it', onError: false, action: { kind: 'record.update', values: { status } } }] } as never,
    { view, templateKeys: new Set(), blockLoopback: true },
  );

describe('a rule that moves a row', () => {
  it('may move it by any move a writer who names nothing may make', () => {
    expect(() => rule('collected')).not.toThrow();
    expect(() => rule('ready')).not.toThrow();
  });

  it('is refused a state only an undo reaches', () => {
    expect(() => rule('preparing')).toThrow(/every move to "preparing" is an undo, which only a person makes/);
  });
});
