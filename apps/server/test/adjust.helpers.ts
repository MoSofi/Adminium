// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test price add-on installed through the add-on routes, attached to a
 * shop installed through the app routes — and a ledger runtime wired the way
 * the server wires one: the kept installs, the add-on's real deciding file,
 * the store's own version. Rows are seeded straight into the database, by
 * name: what a test reads back is what it put there.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { expect } from 'vitest';

import { loadDecider, type InstalledDecider } from '../src/add-ons/decide.js';
import { realRuleRefs } from '../src/apps/manifest-rules.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { tableRulesFor, type TableRules } from '../src/crud/column-rules.js';
import { SnapshotView, type ResolvedTable } from '../src/crud/identifiers.js';
import type { WriteTarget } from '../src/crud/write-context.js';
import { createLedgerRuntime, type LedgerRuntime, type LedgerRuntimeDeps, type ResolvedAdjuster } from '../src/ledgers/registry.js';
import { addOnHarness, type Dialect, type Harness } from './app-add-ons.helpers.js';
import { CATEGORY, MARKET, PRICE_KIT, PRICE_KIT_SERVER, PRICES, marketManifest, priceKitFiles, priceKitManifest, type Item } from './fixtures/price-kit/index.js';

type Doc = Record<string, unknown>;

/** The day every worked figure is placed on: a Wednesday. */
export const SAMPLE_DAY = '2026-09-30';
export const SAMPLE_NOW = '2026-09-30T10:00:00.000Z';

export interface PriceWorld {
  h: Harness;
  dialect: Dialect;
  db: Kysely<SourceDatabase>;
  view(): SnapshotView;
  /** Reads the rules again, after a route stored or switched one. */
  reload(): Promise<void>;
  /** A table by its real name (`market_orders`, `price_kit_offers`). */
  table(name: string): ResolvedTable;
  target(name: string): WriteTarget;
  rules(name: string): TableRules | null;
  runtime: LedgerRuntime;
  /** A runtime over the same installs with something changed (code not loaded, another version). */
  runtimeWith(over: Partial<LedgerRuntimeDeps>): LedgerRuntime;
  decider: InstalledDecider;
  /** The add-on as it answers the shop's orders now; fails when the rule is not live. */
  adjuster(): ResolvedAdjuster;
  /** How a table is named in rows another manifest keeps. */
  refOf(name: string): string;
  /** One row put straight into a table; answers its id. */
  insert(name: string, row: Doc): Promise<number>;
  rows(statement: string): Promise<Doc[]>;
  /** A yes/no as each engine's SQL spells it. */
  flag(on: boolean): string;
  /** The shop's things and categories, by name. */
  items: Record<Item, number>;
  categories: Record<string, number>;
  misbehave(how: string | null): Promise<unknown>;
  close(): Promise<void>;
}

export interface PriceWorldOptions {
  kit?: Doc;
  market?: Doc;
  /** The apps the add-on is attached to as it is installed; the shop when absent. */
  attachTo?: string[];
  /** Leave the add-on out: the shop alone, its rule naming an add-on that is not here. */
  noKit?: boolean;
}

/** The shop and the price kit, installed; the shop's things in. */
export async function priceWorld(dialect: Dialect, options: PriceWorldOptions = {}): Promise<PriceWorld> {
  const h = await addOnHarness(dialect, { unbuiltWords: {} });
  const asked = options.market ?? marketManifest();
  // Until a save asks the price, an install refuses a manifest with a price rule: the shop goes in without its rule,
  // and the rule is stored the way its install stores one — as the app's own, its child tables by their real ids.
  const tables = (asked['requiredSchema'] as { tables: Doc[] }).tables;
  const ruled = tables.filter((candidate) => candidate['adjust'] !== undefined).map((candidate) => ({ ref: String(candidate['ref']), adjust: candidate['adjust'] as Doc }));
  const market: Doc = { ...asked, requiredSchema: { ...(asked['requiredSchema'] as Doc), tables: tables.map(({ adjust: _adjust, ...rest }) => rest) } };
  await h.stageApp(market);
  const installed = await h.install(MARKET, String(market['version']));
  expect(installed.statusCode, installed.body).toBe(200);
  const kit = options.kit ?? priceKitManifest();
  if (options.noKit !== true) {
    await h.stageAddOn(kit, { files: priceKitFiles(kit) });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: PRICE_KIT, version: String(kit['version']), attachTo: options.attachTo ?? [MARKET] } });
    expect(added.statusCode, added.body).toBe(200);
  }
  await h.introspect();
  const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
  for (const { ref, adjust } of ruled) {
    const realId = (name: string) => model.tables.find((candidate) => candidate.name === `market_${name}`)?.id ?? '';
    const mapped = realRuleRefs('table.adjust', adjust, realId, MARKET);
    expect(mapped.missing).toEqual([]);
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.adjust', tableName: realId(ref), columnName: null, value: mapped.value, origin: 'app' } as never);
  }
  const read = async () => new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
  let view = await read();
  const { db, dialect: engine } = await h.manager.data(h.connectionId);
  const table = (name: string): ResolvedTable => view.table(model.tables.find((candidate) => candidate.name === name)!.id);
  const target = (name: string): WriteTarget => ({ connectionId: h.connectionId, view, table: table(name), db, dialect: engine, timezone: 'UTC' });
  const installs = keepAddOnInstalls(h.meta, async () => model);
  await installs.fresh();
  const decider = loadDecider({ key: PRICE_KIT, version: String(kit['version']), path: 'dist/server.js', bytes: PRICE_KIT_SERVER });
  const deps: LedgerRuntimeDeps = {
    installs: () => installs.current(),
    refresh: () => installs.fresh(),
    decider: () => null,
    adjustDecider: (key) => (key === PRICE_KIT ? decider : null),
    versionNow: async (key) => {
      const row = await h.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
      return row === undefined ? null : { version: row.version, status: row.status };
    },
  };
  const runtime = createLedgerRuntime(deps);

  const bind = (value: unknown): unknown => {
    if (typeof value === 'boolean') return dialect === 'postgres' ? value : value ? 1 : 0;
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
    return value;
  };
  const insert: PriceWorld['insert'] = async (name, row) => {
    const at = table(name);
    await db
      .insertInto(at.id as never)
      .values(Object.fromEntries(Object.entries(row).map(([column, value]) => [column, bind(value)])) as never)
      .execute();
    const last = (await db.selectFrom(at.id as never).select(sql<number>`max(id)`.as('id')).executeTakeFirst()) as { id: number } | undefined;
    return Number(last!.id);
  };

  // The shop's things: a category each, by name.
  const categories: Record<string, number> = {};
  for (const name of [...new Set(Object.values(CATEGORY))]) categories[name] = await insert('market_categories', { name });
  const items = {} as Record<Item, number>;
  for (const name of Object.keys(PRICES) as Item[]) items[name] = await insert('market_items', { name, category_id: categories[CATEGORY[name]], price: PRICES[name] });

  return {
    h,
    dialect,
    db,
    view: () => view,
    reload: async () => {
      await installs.fresh();
      view = await read();
    },
    table,
    target,
    rules: (name) => tableRulesFor({ view, table: table(name) }),
    runtime,
    runtimeWith: (over) => createLedgerRuntime({ ...deps, ...over }),
    decider,
    adjuster: () => {
      const answer = runtime.adjuster!(view, table('market_orders'));
      if (answer.state !== 'live') throw new Error(`the shop's price rule is not live: ${JSON.stringify(answer)}`);
      return answer.adjuster;
    },
    refOf: (name) => runtime.refOf(h.connectionId, table(name).id),
    insert,
    rows: (statement) => h.rows(statement),
    flag: (on) => (dialect === 'postgres' ? String(on) : on ? '1' : '0'),
    items,
    categories,
    misbehave: (how) => h.rows(`UPDATE price_kit_settings SET misbehave = ${how === null ? 'NULL' : `'${how}'`}`),
    close: () => h.close(),
  };
}

/** A line of an order as the shop's tables keep one: a thing, how many, and what it costs. */
export const lineOf = (world: Pick<PriceWorld, 'items' | 'categories'>, item: Item, qty: number, over: Doc = {}): Doc => ({
  item_id: world.items[item],
  category_id: world.categories[CATEGORY[item]],
  unit_price: PRICES[item],
  qty,
  amount: (Number(PRICES[item]) * qty).toFixed(2),
  ...over,
});

/** The offers of the sample, as the kit's tables keep them; answers their ids by name. */
export async function seedOffers(world: PriceWorld): Promise<{ offers: Record<string, number>; codes: Record<string, number> }> {
  const categories = world.refOf('market_categories');
  const offers: Record<string, number> = {};
  const add = async (name: string, row: Doc) => {
    offers[name] = await world.insert('price_kit_offers', { name, ...row });
  };
  await add('Welcome 10', { public_name: { 'en-US': 'Welcome 10', 'de-DE': 'Willkommen 10' }, kind: 'percent', value: '10.00', trigger: 'code', scope: 'order', max_per_customer: 1, starts_on: '2026-08-01' });
  await add('Monday mugs', { kind: 'percent', value: '15.00', trigger: 'auto', scope: 'lines', target_as: 'category', target_table: categories, target_row: String(world.categories['Mugs']), weekdays: '1', starts_on: '2026-09-14' });
  await add('Tote pair', { kind: 'bonus_item', trigger: 'auto', scope: 'lines', target_as: 'category', target_table: categories, target_row: String(world.categories['Bags']), buy_qty: 2, starts_on: '2026-09-24' });
  await add('Autumn 5', { kind: 'amount', value: '5.00', trigger: 'code', scope: 'order', min_spend: '30.00', max_uses: 100, uses: 20, starts_on: '2026-09-14', ends_on: '2026-11-30' });
  await add('Launch week', { kind: 'percent', value: '20.00', trigger: 'code', scope: 'order', max_uses: 50, uses: 50, starts_on: '2026-09-01', ends_on: '2026-09-30' });
  await add('Summer close-out', { status: 'ended', kind: 'percent', value: '25.00', trigger: 'auto', scope: 'order', starts_on: '2026-07-01', ends_on: '2026-08-31' });
  const codes: Record<string, number> = {};
  for (const [code, offer] of [['WELCOME10', 'Welcome 10'], ['AUTUMN5', 'Autumn 5'], ['LAUNCH20', 'Launch week']] as const) {
    codes[code] = await world.insert('price_kit_codes', { code, offer_id: offers[offer] });
  }
  return { offers, codes };
}
