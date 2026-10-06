// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN A POSTING FIRES — the points of a rule, judged on a row as it was and
 * as it is. A point is crossed, never merely held; a line answers for its own
 * create and its `own` points, its parent for every other; what is given back
 * runs before what is taken.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { tableRulesFor } from '../src/crud/column-rules.js';
import { needsStored } from '../src/crud/decide.js';
import { SnapshotView } from '../src/crud/identifiers.js';

import { firedPoints, frozenColumns, lineTaken, ownPoint, pointReached, postingScope, type DeclaredPosting, type LinePosting } from '../src/crud/ledger-points.js';

const rule = (over: Partial<DeclaredPosting> = {}): DeclaredPosting => ({ id: 'stock', into: { addOn: 'ledger-kit', ledger: 'stock', action: 'take' }, map: { account: 'account_id', amount: 'qty' }, ...over });
const fired = (list: ReturnType<typeof firedPoints>) => list.map((point) => `${point.posting.id}:${point.phase}:${point.role}`);

describe('a point', () => {
  it('create is reached by a create and by nothing else', () => {
    expect(pointReached({ create: true }, null, { id: 1 }, undefined)).toBe(true);
    expect(pointReached({ create: true }, { id: 1 }, { id: 1 }, undefined)).toBe(false);
  });

  it('a state is reached when the row moves INTO it: not while it stays, not when another column changes', () => {
    const to = { to: ['picked_up', 'done'] };
    expect(pointReached(to, { status: 'ready' }, { status: 'picked_up' }, 'status')).toBe(true);
    expect(pointReached(to, null, { status: 'picked_up' }, 'status')).toBe(true);
    expect(pointReached(to, { status: 'picked_up', note: 'a' }, { status: 'picked_up', note: 'b' }, 'status')).toBe(false);
    // From one state of the list to another of it: it was already there.
    expect(pointReached(to, { status: 'done' }, { status: 'picked_up' }, 'status')).toBe(false);
    expect(pointReached(to, { status: 'ready' }, { status: 'cancelled' }, 'status')).toBe(false);
    // A table with no state column has no state to move.
    expect(pointReached(to, { status: 'ready' }, { status: 'picked_up' }, undefined)).toBe(false);
  });

  it('with `from`, only out of one of those states — a row made in the state came from nowhere', () => {
    const point = { to: ['cancelled'], from: ['placed', 'ready'] };
    expect(pointReached(point, { status: 'ready' }, { status: 'cancelled' }, 'status')).toBe(true);
    expect(pointReached(point, { status: 'picked_up' }, { status: 'cancelled' }, 'status')).toBe(false);
    expect(pointReached(point, null, { status: 'cancelled' }, 'status')).toBe(false);
  });

  it('a column reaching a value reads that column, whatever the state column is', () => {
    const point = { column: 'outcome', in: ['seen'] };
    expect(pointReached(point, { outcome: 'booked', status: 'x' }, { outcome: 'seen', status: 'x' }, 'status')).toBe(true);
    expect(pointReached(point, { outcome: 'seen' }, { outcome: 'seen' }, 'status')).toBe(false);
    // Compared as values are kept: a number a driver hands back as text is the same number.
    expect(pointReached({ column: 'step', in: [2] }, { step: '1' }, { step: '2' }, undefined)).toBe(true);
  });

  it('a column being filled: empty before, or no row before; never filled twice', () => {
    const point = { column: 'voided_at', set: true as const };
    expect(pointReached(point, { voided_at: null }, { voided_at: '2026-10-06' }, undefined)).toBe(true);
    expect(pointReached(point, { voided_at: '' }, { voided_at: '2026-10-06' }, undefined)).toBe(true);
    expect(pointReached(point, null, { voided_at: '2026-10-06' }, undefined)).toBe(true);
    expect(pointReached(point, { voided_at: '2026-10-05' }, { voided_at: '2026-10-06' }, undefined)).toBe(false);
    expect(pointReached(point, { voided_at: null }, { voided_at: null }, undefined)).toBe(false);
  });
});

describe('what a write reaches', () => {
  const own = rule({ id: 'by-hand', reserve: { on: { to: ['sent'] } }, post: { on: { to: ['done'] } }, reverse: { on: { to: ['cancelled'] } } });
  const line = rule({
    id: 'lines',
    via: 'order_id',
    reserve: { on: { create: true } },
    post: { on: { to: ['picked_up'] } },
    reverse: { on: { to: ['cancelled'], from: ['placed', 'ready'] } },
  });
  const pay = rule({ id: 'pays', into: { addOn: 'cards-kit', ledger: 'value', action: 'pay' }, via: 'order_id', post: { on: { create: true } }, reverse: { on: { column: 'voided_at', set: true, own: true } } });
  const under = (posting: DeclaredPosting, child: string): LinePosting => ({ child, via: 'order_id', parentKey: 'id', posting });

  it('a table that hands nothing to any ledger has no scope', () => {
    expect(postingScope(null)).toBeNull();
    expect(postingScope({ postings: [], asLine: [], linePostings: [] })).toBeNull();
    expect(postingScope({ postings: [own] })).toMatchObject({ postings: [own], asLine: [], linePostings: [] });
  });

  it('a row that is its own source fires the phase its move reaches, and one at a time', () => {
    const scope = postingScope({ postings: [own] })!;
    expect(fired(firedPoints(scope, { status: 'draft' }, { status: 'sent' }, 'update', 'status'))).toEqual(['by-hand:reserve:source']);
    expect(fired(firedPoints(scope, { status: 'sent' }, { status: 'done' }, 'update', 'status'))).toEqual(['by-hand:post:source']);
    expect(fired(firedPoints(scope, { status: 'sent' }, { status: 'cancelled' }, 'update', 'status'))).toEqual(['by-hand:reverse:source']);
    expect(fired(firedPoints(scope, { status: 'sent', note: 'a' }, { status: 'sent', note: 'b' }, 'update', 'status'))).toEqual([]);
    // A delete reaches nothing: a row with an open receipt is not deleted at all.
    expect(firedPoints(scope, { status: 'sent' }, null, 'delete', 'status')).toEqual([]);
    expect(firedPoints(scope, { status: 'draft' }, { status: 'sent' }, 'delete', 'status')).toEqual([]);
  });

  it('a line answers for its own create and its own points; its parent for the rest', () => {
    // On the lines' table: the create, and the payment's own void.
    const lines = postingScope({ asLine: [line, pay] })!;
    expect(fired(firedPoints(lines, null, { order_id: 7 }, 'create'))).toEqual(['lines:reserve:line', 'pays:post:line']);
    expect(fired(firedPoints(lines, { voided_at: null }, { voided_at: 'now' }, 'update'))).toEqual(['pays:reverse:line']);
    // A state the line's own table does not keep is the parent's to cross.
    expect(fired(firedPoints(lines, { status: 'ready' }, { status: 'picked_up' }, 'update', 'status'))).toEqual([]);

    // On the parent: the moves, with where the lines are; never the lines' own points.
    const parent = postingScope({ linePostings: [under(line, 'public.order_lines'), under(pay, 'public.pays')] })!;
    const picked = firedPoints(parent, { status: 'ready' }, { status: 'picked_up' }, 'update', 'status');
    expect(fired(picked)).toEqual(['lines:post:parent']);
    expect(picked[0]!.lines).toEqual({ child: 'public.order_lines', via: 'order_id', parentKey: 'id' });
    expect(fired(firedPoints(parent, null, { status: 'placed' }, 'create', 'status'))).toEqual([]);
    expect(fired(firedPoints(parent, { voided_at: null, status: 'x' }, { voided_at: 'now', status: 'x' }, 'update', 'status'))).toEqual([]);
  });

  it('what is given back runs before what is taken, then by add-on, ledger and rule', () => {
    const a = rule({ id: 'b-rule', post: { on: { column: 'state', in: ['x'] } } });
    const b = rule({ id: 'a-rule', reserve: { on: { column: 'state', in: ['x'] } } });
    const c = rule({ id: 'z-rule', into: { addOn: 'cards-kit', ledger: 'value', action: 'pay' }, reverse: { on: { column: 'state', in: ['x'] } } });
    const d = rule({ id: 'c-rule', into: { addOn: 'cards-kit', ledger: 'value', action: 'pay' }, post: { on: { column: 'state', in: ['x'] } } });
    const scope = postingScope({ postings: [a, b, c, d] })!;
    expect(fired(firedPoints(scope, { state: 'w' }, { state: 'x' }, 'update'))).toEqual(['z-rule:reverse:source', 'a-rule:reserve:source', 'c-rule:post:source', 'b-rule:post:source']);
  });
});

describe('a line that is handed, and the columns a receipt freezes', () => {
  it('a voided line, and a line the rule is not for, are left out', () => {
    expect(lineTaken(rule(), { qty: 1 })).toBe(true);
    expect(lineTaken(rule({ unlessSet: 'voided_at' }), { voided_at: null })).toBe(true);
    expect(lineTaken(rule({ unlessSet: 'voided_at' }), { voided_at: '2026-10-06' })).toBe(false);
    expect(lineTaken(rule({ only: { column: 'method', eq: 'account' } }), { method: 'account' })).toBe(true);
    expect(lineTaken(rule({ only: { column: 'method', eq: 'account' } }), { method: 'cash' })).toBe(false);
    expect(lineTaken(rule({ only: { column: 'method', in: ['card', 'account'] } }), { method: 'cash' })).toBe(false);
    expect(lineTaken(rule({ only: { column: 'gift_ref', set: true } }), { gift_ref: null })).toBe(false);
    expect(lineTaken(rule({ only: { column: 'gift_ref', set: true } }), { gift_ref: 'GC-1' })).toBe(true);
  });

  it('every column a rule reads is frozen; a point\'s own column is how the row moves on', () => {
    const posting = rule({
      via: 'order_id',
      map: { account: 'account_id', amount: 'qty', due: { parent: 'balance_due' }, memo: { value: 'x' }, rate: { setting: 'rate' }, source: { row: true } },
      multipliers: { amount: 'pack_size' },
      heldUntil: { parent: 'hold_until' },
      unlessSet: 'voided_at',
      only: { column: 'method', eq: 'account' },
      post: { on: { column: 'status', in: ['paid'] } },
      reverse: { on: { column: 'voided_at', set: true, own: true } },
    });
    // `voided_at` is the reverse's own point: changing it is the move, not a change of what was posted.
    expect(frozenColumns(posting)).toEqual({ row: ['account_id', 'method', 'order_id', 'pack_size', 'qty'], parent: ['balance_due', 'hold_until'] });
    expect(ownPoint({ create: true })).toBe(true);
    expect(ownPoint({ column: 'voided_at', set: true })).toBe(false);
  });
});

describe('a table\'s rules, as its postings are stored', () => {
  const col = (name: string, extra: Record<string, unknown> = {}) => ({ name, logicalType: 'integer', ...extra });
  const key = col('id', { nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } });
  const table = (name: string, columns: ReturnType<typeof col>[]) => ({ schema: 'public', name, primaryKey: ['id'], columns: [key, ...columns] });
  const stored = (tableName: string, op: string, value: Record<string, unknown>): SchemaOverride => ({
    id: `ovr_${tableName}_${op}`,
    connectionId: 'cnx_test',
    op: op as SchemaOverride['op'],
    tableName,
    columnName: null,
    value,
    origin: 'app',
    llmRunId: null,
    status: 'active',
    createdBy: null,
    createdAt: 0,
    updatedAt: 0,
  });
  const model = applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'shop',
      defaultSchema: 'public',
      schemas: ['public'],
      tables: [table('orders', [col('status', { logicalType: 'text' })]), table('order_lines', [col('order_id'), col('account_id'), col('qty')]), table('requests', [col('account_id'), col('qty')]), table('accounts', []), table('notes', [])],
      relations: [
        { id: 'fk:lines-account', kind: 'declared-fk', cardinality: 'one-to-many', from: { tableId: 'public.order_lines', columns: ['account_id'] }, to: { tableId: 'public.accounts', columns: ['id'] }, onDelete: 'no-action' },
        { id: 'fk:lines-order', kind: 'declared-fk', cardinality: 'one-to-many', from: { tableId: 'public.order_lines', columns: ['order_id'] }, to: { tableId: 'public.orders', columns: ['id'] }, onDelete: 'no-action' },
      ],
    }),
  ) as DatabaseModel;
  const byLine = rule({ id: 'lines', via: 'order_id', reserve: { on: { create: true } }, post: { on: { to: ['picked_up'] } } });
  const byHand = rule({ id: 'by-hand', post: { on: { create: true } } });
  const view = new SnapshotView(
    'cnx_test',
    applyOverrides(model, [
      stored('public.order_lines', 'table.postings', { postings: [byLine] }),
      stored('public.requests', 'table.postings', { postings: [byHand] }),
      stored('public.requests', 'table.switchedOff', { postings: ['by-hand'] }),
    ]),
  );
  const rulesOf = (name: string) => tableRulesFor({ view, table: view.table(`public.${name}`) });

  it('its own rules, the rules whose lines hang under it, and the owner\'s switch', () => {
    expect(rulesOf('requests')).toMatchObject({ postings: [byHand] });
    expect(rulesOf('requests')!.asLine).toBeUndefined();
    expect([...rulesOf('requests')!.switchedOff!.postings]).toEqual(['by-hand']);
    expect(rulesOf('order_lines')).toMatchObject({ asLine: [byLine] });
    expect(rulesOf('order_lines')!.postings).toBeUndefined();
    // The parent knows where its lines are, by the link the rule's `via` is.
    expect(rulesOf('orders')!.linePostings).toEqual([{ child: 'public.order_lines', via: 'order_id', parentKey: 'id', posting: byLine }]);
    // A table the lines merely link to is not their parent: only the row `via` names is.
    expect(rulesOf('accounts')).not.toHaveProperty('linePostings');
    // A table no rule touches carries none of it.
    expect(rulesOf('notes')).not.toHaveProperty('postings');
    expect(rulesOf('notes')).not.toHaveProperty('linePostings');
    expect(postingScope(rulesOf('notes'))).toBeNull();
    expect(postingScope(rulesOf('orders'))).not.toBeNull();
  });

  it('a write to a table with a posting reads the stored row first: a point is crossed, never merely held', () => {
    // Its own rule, its lines' rule and the parent's side of a line rule each need the row as it was.
    expect(needsStored(rulesOf('requests'))).toBe(true);
    expect(needsStored(rulesOf('order_lines'))).toBe(true);
    expect(needsStored(rulesOf('orders'))).toBe(true);
    expect(needsStored(rulesOf('notes'))).toBe(false);
  });
});
