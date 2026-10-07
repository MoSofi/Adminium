// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test shop written through a real write service, wired the way the
 * server wires one: the kept installs, the price add-on's real deciding file,
 * the meta store's own counters and settings. What a test saves goes through
 * the same steps every door's save does.
 */
import type { PostedOutcome } from '../src/crud/ledger-write.js';
import type { Row } from '../src/crud/mask.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService, type RecordWriteService, type UpdateOutcome, type WriteServiceOptions } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import type { TreeNode, TreeOutcome } from '../src/crud/write-tree.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import type { LedgerRuntime } from '../src/ledgers/registry.js';
import { customerKeyOf } from '../src/public-api/customer-key.js';
import type { PriceWorld } from './adjust.helpers.js';
import { CATEGORY, PRICES, type Item } from './fixtures/price-kit/index.js';

type Doc = Record<string, unknown>;

const keyOf = customerKeyOf('a-test-secret-of-some-length');

export const STAFF: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
export const GUEST: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key_1' }, request: null };

/** A row of a tree as a test writes one: its table, its values, and the lists of rows below it. */
export interface TreeSpec {
  table: string;
  values: Doc;
  /** By the wire's name for the list: the child table, its link to this row, and the rows. */
  lists?: Record<string, { table: string; via: string; rows: readonly (Doc | TreeSpec)[] }>;
}

export interface SaveWorld extends PriceWorld {
  writes: RecordWriteService;
  /** A write service over the same stores with another add-on runtime (none at all: `null`) or other options. */
  service(runtime?: LedgerRuntime | null, more?: Partial<WriteServiceOptions>): RecordWriteService;
  key(address: string): string;
  create(table: string, values: Doc, context?: WriteContext, service?: RecordWriteService): Promise<Row>;
  update(table: string, id: unknown, values: Doc, opts?: { context?: WriteContext; mode?: 'dry'; service?: RecordWriteService; expect?: (after: Row) => void }): Promise<UpdateOutcome>;
  remove(table: string, id: unknown, context?: WriteContext, service?: RecordWriteService): Promise<number>;
  /** A row with the rows below it, in one write; a refusal carries where in the tree it is about (`at`). */
  tree(root: TreeSpec, opts?: { context?: WriteContext; mode?: 'dry'; service?: RecordWriteService }): Promise<TreeOutcome>;
  /** What the last create or change handed its door. */
  posted(): PostedOutcome[];
  /** An order's figures as stored, each as money text. */
  figures(order: unknown): Promise<Record<string, string>>;
  /** Each line's reduction as stored, oldest line first. */
  reductions(order: unknown): Promise<string[]>;
  /** What was applied to an order, as `<line's key> <kind> <amount>[ typed]`, oldest row first. */
  applied(order: unknown): Promise<string[]>;
}

const money = (value: unknown): string => (value === null || value === undefined ? 'null' : Number(value).toFixed(2));

/** A line as a writer sends one: the thing, how many, its price — never an amount or a reduction, which are Adminium's. */
export const sentLine = (w: Pick<PriceWorld, 'items' | 'categories'>, item: Item, qty: number, over: Doc = {}): Doc => ({
  item_id: w.items[item],
  category_id: w.categories[CATEGORY[item]],
  unit_price: PRICES[item],
  qty,
  ...over,
});

/** The refusal a save met, with where in a tree it was about; fails when the save went through. */
export async function refused(run: Promise<unknown>): Promise<{ code?: string; details?: Record<string, unknown>; statusCode?: number; at?: readonly (string | number)[] } & Error> {
  try {
    await run;
  } catch (error) {
    return error as never;
  }
  throw new Error('the save went through');
}

export function saveWorld(w: PriceWorld): SaveWorld {
  const service: SaveWorld['service'] = (runtime, more = {}) =>
    createWriteService({ ...writeStores(w.h.meta), rolesOf: async () => 'any' as const, customerKey: keyOf, ...(runtime === null ? {} : { ledgers: runtime ?? w.runtime }), ...more });
  const writes = service();
  let posted: PostedOutcome[] = [];
  const bound = (target: WriteTarget, values: Doc): Row => Object.fromEntries(Object.entries(values).map(([column, value]) => [column, target.table.columns.has(column) ? normalizeWriteValue(target.table.columns.get(column)!, value) : value]));

  const node = (spec: TreeSpec, name: string, at: (string | number)[], via?: { column: string; parentKey: string }): TreeNode => {
    const target = w.target(spec.table);
    const children: TreeNode[] = [];
    for (const [list, below] of Object.entries(spec.lists ?? {})) {
      below.rows.forEach((row, index) => {
        const child: TreeSpec = 'table' in row && 'values' in row ? (row as TreeSpec) : { table: below.table, values: row as Doc };
        children.push(node(child, list, [...at, list, index], { column: below.via, parentKey: target.table.primaryKey[0]! }));
      });
    }
    return { name, target, values: bound(target, spec.values), ...(via === undefined ? {} : { via }), at, children, lists: Object.keys(spec.lists ?? {}) };
  };

  return {
    ...w,
    writes,
    service,
    key: (address) => keyOf(w.h.connectionId, address),
    create(table, values, context = STAFF, using = writes) {
      const target = w.target(table);
      posted = [];
      return using.create({
        target,
        values: bound(target, values),
        context,
        announce: async (_row, _values, outcomes) => {
          posted = [...(outcomes ?? [])];
        },
      });
    },
    update(table, id, values, opts = {}) {
      const target = w.target(table);
      posted = [];
      return (opts.service ?? writes).update({
        target,
        pk: { [target.table.primaryKey[0]!]: id },
        values: bound(target, values),
        context: opts.context ?? STAFF,
        ...(opts.mode === undefined ? {} : { mode: opts.mode }),
        ...(opts.expect === undefined ? {} : { expect: async (_db, after) => opts.expect!(after) }),
        announce: async (outcome) => {
          posted = [...(outcome.postings ?? [])];
        },
      });
    },
    remove(table, id, context = STAFF, using = writes) {
      const target = w.target(table);
      return using.delete({ target, pk: { [target.table.primaryKey[0]!]: id }, context, announce: async () => undefined });
    },
    tree(root, opts = {}) {
      return (opts.service ?? writes).createTree({
        root: node(root, root.table, []),
        context: opts.context ?? STAFF,
        mode: opts.mode ?? 'save',
        announce: async () => undefined,
        mapError: (error, at) => {
          if (error !== null && typeof error === 'object') Object.defineProperty(error, 'at', { value: at, enumerable: false, configurable: true });
          throw error;
        },
      });
    },
    posted: () => posted,
    async figures(order) {
      const [row] = await w.rows(`SELECT subtotal, discount, net, tax, total FROM market_orders WHERE id = ${String(order)}`);
      return Object.fromEntries(Object.entries(row ?? {}).map(([column, value]) => [column, money(value)]));
    },
    reductions: async (order) => (await w.rows(`SELECT discount FROM market_order_lines WHERE order_id = ${String(order)} ORDER BY id`)).map((row) => money(row['discount'])),
    applied: async (order) =>
      (await w.rows(`SELECT source_line, kind, amount, typed FROM price_kit_applied WHERE source_row = '${String(order)}' ORDER BY id`)).map(
        (row) => `${String(row['source_line'])} ${String(row['kind'])} ${money(row['amount'])}${row['typed'] === true || row['typed'] === 1 ? ' typed' : ''}`,
      ),
  };
}
