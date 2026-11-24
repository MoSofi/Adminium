// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An order with a paid label cannot quietly go backwards: which moves count,
 * who may keep the label, and what each person is told.
 */
import { applyMigrations, createSqliteMetaDb, shippingBookingsRepo, type MetaDb, type NewShippingBooking } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Kysely, SqliteDialect, sql } from 'kysely';

import { attachGuard, guardedUpdate, movesBack } from '../src/crud/states.js';
import { PAID_LABEL_HEADER, paidLabelJudge } from '../src/shipping/order-guard.js';
import { orderCancelled } from '../src/shipping/limits.js';
import { ShippingRefusal } from '../src/shipping/refusals.js';

const MOVES = {
  paid: [{ to: 'packed' }, { to: 'cancelled' }],
  packed: [{ to: 'shipped' }, { to: 'paid', undo: true }, { to: 'cancelled' }],
  making: ['ready'],
  ready: ['making', 'posted'],
} as never;

describe('a cancelled order', () => {
  it('is read from the table\'s own status column, in either spelling', () => {
    expect(orderCancelled({ column: 'status' }, { status: 'cancelled' })).toBe(true);
    expect(orderCancelled({ column: 'stage' }, { stage: 'Canceled' })).toBe(true);
    expect(orderCancelled({ column: 'status' }, { status: 'packed' })).toBe(false);
    expect(orderCancelled({ column: 'status' }, { status: null })).toBe(false);
    expect(orderCancelled(undefined, { status: 'cancelled' })).toBe(false);
  });
});

describe('which moves take an order back', () => {
  it('counts an undo, a cancel and a step to an earlier state, and no step forward', () => {
    expect(movesBack({ moves: MOVES }, 'packed', 'paid', { to: 'paid', undo: true })).toBe(true);
    expect(movesBack({ moves: MOVES }, 'packed', 'cancelled', { to: 'cancelled' })).toBe(true);
    expect(movesBack({ moves: MOVES }, 'ready', 'making', 'making')).toBe(true);
    expect(movesBack({ moves: MOVES }, 'packed', 'shipped', { to: 'shipped' })).toBe(false);
    expect(movesBack({ moves: MOVES }, 'ready', 'posted', 'posted')).toBe(false);
  });

  // The three shops' real order states: each has a pair of states that can reach each other.
  it.each([
    ['Maker Shop', 'placed', { placed: ['making', 'cancelled'], making: ['ready', 'cancelled'], ready: ['posted', 'making'] }, [['making', 'ready'], ['ready', 'posted'], ['placed', 'making']], [['ready', 'making']]],
    ['Print Shop', 'placed', { placed: ['ready', 'cancelled'], ready: ['collected', 'dispatched', 'placed'] }, [['placed', 'ready'], ['ready', 'dispatched']], [['ready', 'placed']]],
    ['Online Shop', 'paying', { paying: ['paid', 'cancelled'], awaiting_transfer: ['paid', 'cancelled'], paid: ['packed', 'sent', 'cancelled'], packed: ['shipped', { to: 'paid', undo: true }, 'cancelled'], sent: ['cancelled'] }, [['paid', 'packed'], ['packed', 'shipped'], ['paying', 'paid'], ['awaiting_transfer', 'paid']], [['packed', 'paid']]],
  ] as const)('%s: the step forward of a reversible pair is not a move back', (_shop, initial, moves, forward, back) => {
    const states = { initial, moves: moves as never };
    const move = (from: string, to: string) => ((moves as unknown as Record<string, (string | { to: string })[]>)[from] ?? []).find((one) => (typeof one === 'string' ? one : one.to) === to);
    for (const [from, to] of forward) expect(movesBack(states, from, to, move(from, to)), `${from} to ${to}`).toBe(false);
    for (const [from, to] of back) expect(movesBack(states, from, to, move(from, to)), `${from} to ${to}`).toBe(true);
  });
});

describe('the state machine asks the guard', () => {
  const table = {
    id: 'orders',
    name: 'orders',
    primaryKey: ['id'],
    columns: new Map([['id', {}], ['status', {}]]),
    table: { states: { column: 'status', initial: 'paid', moves: MOVES } },
  } as never;

  it('on a move back, on the row as held, and never on a move forward', async () => {
    const db = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) });
    await sql`create table orders (id integer primary key, status text)`.execute(db);
    await sql`insert into orders values (1, 'packed')`.execute(db);
    const asked: string[] = [];
    const write = (to: string, extra: Record<string, unknown>) =>
      guardedUpdate(
        db as never,
        'sqlite',
        table,
        attachGuard({ status: to, ...extra }, {
          history: false,
          roles: 'any',
          decided: [],
          paidLabelMove: async (row, from, target) => {
            asked.push(`${String(row['id'])}:${from}>${target}`);
            throw new ShippingRefusal('ORDER_HAS_PAID_LABEL', 'held');
          },
        }),
        { id: 1 },
        async (tx) => Number((await sql`update orders set status = ${to} where id = 1`.execute(tx as never)).numAffectedRows ?? 0n),
      );
    await expect(write('cancelled', {})).rejects.toMatchObject({ code: 'ORDER_HAS_PAID_LABEL' });
    expect(asked).toEqual(['1:packed>cancelled']);
    expect((await sql<{ status: string }>`select status from orders`.execute(db)).rows[0]?.status).toBe('packed');
    await write('shipped', {});
    expect(asked).toHaveLength(1);
    expect((await sql<{ status: string }>`select status from orders`.execute(db)).rows[0]?.status).toBe('shipped');
    await db.destroy();
  });
});

describe('the paid label guard', () => {
  let meta: MetaDb;
  let n = 0;
  const target = { connectionId: 'conn_one', table: { id: 'shop_orders', primaryKey: ['id'] } } as never;
  const install = { row: { id: 'mft_shop', manifestKey: 'shop', connectionId: 'conn_one' } };
  const manifests = { findById: async () => install } as never;
  const person = (can: boolean, header?: string): FastifyRequest =>
    ({ headers: header === undefined ? {} : { [PAID_LABEL_HEADER]: header }, user: { id: 'usr_one' }, can: async () => can, log: { info: () => undefined } }) as unknown as FastifyRequest;

  const label = async (mode: 'live' | 'test' = 'live') => {
    n += 1;
    const input: NewShippingBooking = {
      installId: 'mft_shop', carrierInstallId: 'mft_carrier', carrierKey: 'carrier-one', connectionId: 'conn_one', tableRef: 'orders', tableName: 'shop_orders', rowKey: String(n), purpose: 'outbound', parcelNumber: 1,
      reference: `NL-${n}`, mode, accountFingerprint: 'f'.repeat(64), detailsHash: 'd'.repeat(64), service: 'Evri 48', rateCode: 'evri-48', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: 'usr_one',
    };
    const made = await shippingBookingsRepo(meta).reserve(input, 1000);
    if (!made.ok) throw new Error('no booking');
    await shippingBookingsRepo(meta).move(made.booking.id, ['reserved'], 'booked', { carrierShipmentId: `tx_${n}`, tracking: `TRK-${n}`, answeredAt: Date.now() }, 1000);
    return { id: made.booking.id, row: { id: n } };
  };
  const refusal = async (work: Promise<void>): Promise<ShippingRefusal | null> => {
    try {
      await work;
      return null;
    } catch (error) {
      if (error instanceof ShippingRefusal) return error;
      throw error;
    }
  };

  beforeAll(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await applyMigrations(meta.db, { dialect: meta.dialect });
  });
  afterAll(() => meta.db.destroy());

  it('refuses a move with a live label and names it', async () => {
    const one = await label();
    const said = await refusal(paidLabelJudge(meta, manifests)(target, { origin: 'dashboard', request: person(true) }, one.row, 'packed', 'cancelled'));
    expect(said).toMatchObject({ code: 'ORDER_HAS_PAID_LABEL', details: { mayKeep: true, labels: [{ booking: one.id, canRequest: true, scanned: false }] } });
  });

  it('lets someone who may cancel keep the label, only for the labels they were told about', async () => {
    const one = await label();
    const judge = paidLabelJudge(meta, manifests);
    expect(await refusal(judge(target, { origin: 'dashboard', request: person(true, one.id) }, one.row, 'packed', 'paid'))).toBeNull();
    expect((await refusal(judge(target, { origin: 'dashboard', request: person(true, 'shb_other') }, one.row, 'packed', 'paid')))?.code).toBe('ORDER_HAS_PAID_LABEL');
  });

  it('does not take the answer from someone with no right to cancel labels, or from an API key', async () => {
    const one = await label();
    const judge = paidLabelJudge(meta, manifests);
    const packer = await refusal(judge(target, { origin: 'dashboard', request: person(false, one.id) }, one.row, 'packed', 'paid'));
    expect(packer).toMatchObject({ code: 'ORDER_HAS_PAID_LABEL', details: { mayKeep: false } });
    const key = { ...person(true, one.id), apiKeyPrincipal: { id: 'key' } } as unknown as FastifyRequest;
    expect((await refusal(judge(target, { origin: 'dashboard', request: key }, one.row, 'packed', 'paid')))?.code).toBe('ORDER_HAS_PAID_LABEL');
  });

  it('tells a customer nothing about the label', async () => {
    const one = await label();
    const said = await refusal(paidLabelJudge(meta, manifests)(target, { origin: 'public', request: null }, one.row, 'paid', 'cancelled'));
    expect(said?.code).toBe('ORDER_HAS_PAID_LABEL');
    expect(JSON.stringify(said?.details ?? {})).not.toContain(one.id);
  });

  it('is not held by a test label or a label with its refund requested', async () => {
    const sample = await label('test');
    const judge = paidLabelJudge(meta, manifests);
    expect(await refusal(judge(target, { origin: 'dashboard', request: person(false) }, sample.row, 'packed', 'paid'))).toBeNull();
    const asked = await label();
    await shippingBookingsRepo(meta).askVoid(asked.id, 'usr_one', 2000);
    expect(await refusal(judge(target, { origin: 'dashboard', request: person(false) }, asked.row, 'packed', 'paid'))).toBeNull();
  });
});
