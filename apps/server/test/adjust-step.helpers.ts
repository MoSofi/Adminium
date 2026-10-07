// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The price step on its own: built over the test shop with the statements a
 * write service gives it, and run on a transaction a test opens — so what it
 * reads, asks and writes is seen apart from the save that calls it.
 */
import type { Kysely, KyselyPlugin } from 'kysely';

import type { SourceDatabase } from '../src/connections/manager.js';
import { createAdjuster, type AdjustFor, type AdjustKit, type AdjustResult, type AdjustRun } from '../src/crud/adjust/step.js';
import { tableRulesFor } from '../src/crud/column-rules.js';
import type { Row } from '../src/crud/mask.js';
import { writeClock } from '../src/crud/write-clock.js';
import type { WriteContext } from '../src/crud/write-context.js';
import { deleteRows, insertRows, updateRows } from '../src/crud/write-service.js';
import type { LedgerRuntime } from '../src/ledgers/registry.js';
import { customerKeyOf } from '../src/public-api/customer-key.js';
import { SAMPLE_NOW, lineOf, type PriceWorld } from './adjust.helpers.js';
import type { Item } from './fixtures/price-kit/index.js';

type Db = Kysely<SourceDatabase>;
type Doc = Record<string, unknown>;

const keyOf = customerKeyOf('a-test-secret-of-some-length');

export const STAFF: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
export const PUBLIC: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key_1' }, request: null };
export const SYSTEM: WriteContext = { origin: 'automation', hops: 0, actor: { kind: 'automation', id: 'rule_1', label: 'A rule' }, request: null };

/** A sign a transaction is ended with on purpose: nothing it wrote is kept. */
class Undone extends Error {}

export interface Stepper {
  kit: AdjustKit;
  adjuster: ReturnType<typeof createAdjuster>;
  /** The customer key of an address in the test's connection. */
  key(address: string): string;
  /** The shop's orders with the add-on as it answers now; fails when the rule is not live. */
  orders(runtime?: LedgerRuntime): Promise<AdjustFor>;
  /** One order priced again in a transaction of its own, kept. `counted`: the statements the step issued that write. */
  run(order: number, over?: Partial<Omit<AdjustRun, 'for' | 'key'>> & { runtime?: LedgerRuntime }): Promise<{ result: AdjustResult | null; writes: number }>;
  /** The same, on a transaction that is rolled back: `inside` reads what stands before it is. */
  quote<T>(order: number, inside: (trx: Db, result: AdjustResult | null) => Promise<T>, over?: Partial<Omit<AdjustRun, 'for' | 'key'>>): Promise<T>;
  /** An order put straight into the shop's tables, with its lines and the codes typed on it. */
  place(input: { lines: readonly (readonly [Item, number, Doc?])[]; codes?: readonly string[]; order?: Doc }): Promise<{ id: number; lines: number[]; codes: number[] }>;
  /** The reductions an order's rows hold now: each line's, the order's own figures, and what was applied. */
  stands(order: number): Promise<{ lines: string[]; order: Record<string, string>; applied: string[] }>;
}

const money = (value: unknown): string => Number(value ?? 0).toFixed(2);

export function stepperOf(w: PriceWorld): Stepper {
  const kitFor = (runtime: LedgerRuntime): AdjustKit => ({
    ledgers: runtime,
    rulesOf: (target) => tableRulesFor({ view: target.view, table: target.table }),
    withRights: async (target) => target,
    hooked: async () => false,
    update: async (target, set, key) => {
      await updateRows(target.db, target.dialect, target.table, set as never, key);
    },
    insert: (target, rows) => insertRows(target.db, target.dialect, target.table, rows as never),
    remove: async (target, match) => {
      await deleteRows(target.db, target.table, match);
    },
    currency: async () => 'USD',
    zone: async (target) => target.timezone ?? 'UTC',
    customerKey: keyOf,
    rolesOf: async () => 'any',
  });
  const kit = kitFor(w.runtime);
  const adjuster = createAdjuster(kit);
  const orders: Stepper['orders'] = async (runtime) => {
    const target = w.target('market_orders');
    const peeked = await (runtime === undefined ? adjuster : createAdjuster(kitFor(runtime))).peek({ target, rules: w.rules('market_orders'), action: 'create', values: {}, context: STAFF });
    if (peeked === null) throw new Error('the shop\'s price rule is not live');
    return peeked.orders[0]!;
  };
  const args = async (order: number, over: Partial<Omit<AdjustRun, 'for' | 'key'>> & { runtime?: LedgerRuntime } = {}): Promise<AdjustRun> => {
    const { runtime: _runtime, ...rest } = over;
    // An order already stored, priced again: it stood as it is read. (A test of an order the save itself makes says `stood: null`.)
    const stood = ((await w.db.selectFrom(w.table('market_orders').id as never).selectAll().where('id' as never, '=', order as never).executeTakeFirst()) as Row | undefined) ?? null;
    return { for: await orders(over.runtime), key: order, stood, touches: true, mode: 'save', context: STAFF, clock: writeClock(null, () => new Date(SAMPLE_NOW)), ...rest };
  };
  return {
    kit,
    adjuster,
    key: (address) => keyOf(w.h.connectionId, address),
    orders,
    async run(order, over = {}) {
      const input = await args(order, over);
      let writes = 0;
      const plugin: KyselyPlugin = {
        transformQuery: (query) => {
          if (query.node.kind !== 'SelectQueryNode') writes += 1;
          return query.node;
        },
        transformResult: async (query) => query.result,
      };
      const stepper = over.runtime === undefined ? adjuster : createAdjuster(kitFor(over.runtime));
      const result = await w.db.transaction().execute((trx) => stepper.run(trx.withPlugin(plugin) as never, input));
      return { result, writes };
    },
    async quote(order, inside, over = {}) {
      const input = await args(order, { mode: 'dry', ...over });
      let out: unknown;
      try {
        await w.db.transaction().execute(async (trx) => {
          out = await inside(trx as never, await adjuster.run(trx as never, input));
          throw new Undone();
        });
      } catch (error) {
        if (!(error instanceof Undone)) throw error;
      }
      return out as never;
    },
    async place(input) {
      const subtotal = input.lines.reduce((sum, [item, qty, over]) => sum + Number((over?.['amount'] as string | undefined) ?? lineOf(w, item, qty)['amount']), 0);
      const id = await w.insert('market_orders', { status: 'open', subtotal: subtotal.toFixed(2), net: subtotal.toFixed(2), ...(input.order ?? {}) });
      const lines: number[] = [];
      for (const [item, qty, over] of input.lines) lines.push(await w.insert('market_order_lines', { order_id: id, ...lineOf(w, item, qty, over) }));
      const codes: number[] = [];
      for (const typed of input.codes ?? []) codes.push(await w.insert('market_order_codes', { order_id: id, typed }));
      return { id, lines, codes };
    },
    async stands(order) {
      const lines = (await w.rows(`SELECT discount FROM market_order_lines WHERE order_id = ${String(order)} ORDER BY id`)).map((row) => money(row['discount']));
      const [row] = (await w.rows(`SELECT subtotal, discount, net, tax, total FROM market_orders WHERE id = ${String(order)}`)) as Row[];
      const applied = (
        await w.rows(`SELECT source_table, source_line, kind, amount, typed, offer_id, code_id, voucher_id FROM price_kit_applied WHERE source_row = '${String(order)}' ORDER BY id`)
      ).map((kept) => `${String(kept['source_line'])} ${String(kept['kind'])} ${money(kept['amount'])}${kept['typed'] === true || kept['typed'] === 1 ? ' typed' : ''}`);
      return { lines, order: Object.fromEntries(Object.entries(row ?? {}).map(([column, value]) => [column, value === null ? 'null' : money(value)])), applied };
    },
  };
}
