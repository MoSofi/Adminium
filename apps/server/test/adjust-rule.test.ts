// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PRICE RULE AS A WRITE READS IT, and whether it runs now.
 *
 * A stored rule is turned into what every save asks of it: on the order's
 * table its parts, the columns whose change asks the price again and the
 * columns only Adminium writes; on each table whose rows are part of an order
 * — a line, a typed code — which order that is. Whether the rule is LIVE is
 * the registry's answer, and it has four: not there, switched off, live, and
 * "it should run and nobody can be asked".
 */
import type { AddOnManifest, AppManifest } from '@adminium/manifest';
import type { SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import type { InstalledDecider } from '../src/add-ons/decide.js';
import type { AddOnInstalls, InstalledAddOn } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { adjustParentsOf, compileAdjust, frozenNow, isLine, lineKey, touched } from '../src/crud/adjust/rule.js';
import { tableRulesFor, withoutReadOnly } from '../src/crud/column-rules.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { MARKET_ADJUST, marketManifest, priceKitManifest } from './fixtures/price-kit/index.js';
import { manifestOf, modelOf, store } from './rule-round-trip.helpers.js';

type Doc = Record<string, unknown>;

const KIT = manifestOf(priceKitManifest()) as AddOnManifest;
const KIT_TABLES = (KIT.requiredSchema?.tables ?? []).map((table) => table.ref);
const id = (ref: string) => `public.market_${ref}`;
const kitId = (ref: string) => `public.price_kit_${ref}`;

/** The shop's tables and the kit's in one database, with the shop's rules as its install stores them. */
function world(over: { market?: Doc; more?: SchemaOverride[]; kitTables?: string[]; origin?: SchemaOverride['origin']; relink?: (relation: { from: { tableId: string; columns: string[] }; to: { tableId: string; columns: string[] } }) => void; rekey?: (table: { id: string; primaryKey: string[] }) => void } = {}) {
  const market = manifestOf(over.market ?? marketManifest()) as AppManifest;
  const stored = store(market, 'market_', expect);
  const shop = modelOf(market.requiredSchema.tables, 'market_');
  const kit = modelOf(KIT.requiredSchema?.tables ?? [], 'price_kit_');
  // A table of the kit's dropped by hand: gone from the database, with every link to or from it.
  const here = new Set((over.kitTables ?? KIT_TABLES).map(kitId));
  const base = {
    ...shop,
    tables: [...shop.tables, ...kit.tables.filter((table) => here.has(table.id))],
    relations: [...shop.relations, ...kit.relations.filter((relation) => here.has(relation.from.tableId) && here.has(relation.to.tableId))],
  };
  for (const relation of base.relations) over.relink?.(relation as never);
  for (const table of base.tables) over.rekey?.(table as never);
  const rows = stored.rows.map((row) => (over.origin !== undefined && row.op === 'table.adjust' ? { ...row, origin: over.origin } : row));
  const view = new SnapshotView('cnx', applyOverrides(base, [...rows, ...(over.more ?? [])]));
  return { view, rows: stored.rows, orders: view.table(id('orders')), table: (ref: string) => view.table(id(ref)) };
}

const rulesOf = (w: ReturnType<typeof world>, ref: string) => tableRulesFor({ view: w.view, table: w.table(ref) });

describe('the price rule of an order\'s table', () => {
  const w = world();
  const adjust = compileAdjust(w.orders.table)!;

  it('names who answers, the order\'s key, and its parts in the order declared', () => {
    expect(adjust).toMatchObject({ addOn: 'price-kit', table: id('orders'), key: 'id' });
    expect(adjust.parts).toEqual([
      {
        index: 0,
        self: false,
        table: id('order_lines'),
        via: 'order_id',
        price: 'unit_price',
        quantity: 'qty',
        discount: 'discount',
        what: MARKET_ADJUST.lines[0]!.what,
        excludes: 'card_load',
        paidBy: 'paid_by',
        only: { column: 'kind', in: ['item', 'extra'] },
        unlessSet: 'voided_at',
        inputs: ['order_id', 'unit_price', 'qty', 'item_id', 'category_id', 'tag', 'card_load', 'paid_by', 'kind', 'voided_at'],
      },
    ]);
    expect(adjust.codes).toEqual({ ...MARKET_ADJUST.codes, table: id('order_codes') });
  });

  it('tells apart what decides WHICH reductions an order has from what its own line is worth', () => {
    expect(adjust.inputs).toEqual({ uses: ['staff_kind', 'staff_value', 'staff_reason', 'customer_id'], lines: [] });
    const stay = compileAdjust({ id: 'public.stays', primaryKey: ['id'], adjust: { by: { addOn: 'price-kit' }, order: { discount: 'discount', currency: 'currency' }, lines: [{ self: true, price: 'room_total', discount: 'discount', what: [{ column: 'room_type_id', as: 'type' }], nights: { from: 'check_in', to: 'check_out', rate: 'room_total' } }] } })!;
    expect(stay.inputs).toEqual({ uses: [], lines: ['room_total', 'room_type_id', 'check_in', 'check_out', 'currency'] });
    expect(stay.parts[0]).toMatchObject({ self: true, table: 'public.stays', nights: { from: 'check_in', to: 'check_out', rate: 'room_total' } });
    expect(stay.parts[0]!.via).toBeUndefined();
    expect(stay.decided).toEqual(['discount']);
  });

  it('lists the order\'s columns only Adminium writes', () => {
    expect(adjust.decided).toEqual(['discount', 'staff_by', 'customer_proved']);
  });

  it('is none for a table with no rule, and for one whose rows no single column names', () => {
    expect(compileAdjust(w.table('items').table)).toBeUndefined();
    expect(compileAdjust(undefined)).toBeUndefined();
    expect(compileAdjust({ ...w.orders.table, primaryKey: ['id', 'status'] })).toBeUndefined();
  });
});

describe('the tables whose rows are part of an order', () => {
  const w = world();

  it('a line and a typed code each know their order, and which of their own columns the price depends on', () => {
    expect(adjustParentsOf(w.view.model, w.table('order_lines').table)).toEqual([
      { order: id('orders'), orderKey: 'id', via: 'order_id', as: 'line', part: 0, inputs: ['order_id', 'unit_price', 'qty', 'item_id', 'category_id', 'tag', 'card_load', 'paid_by', 'kind', 'voided_at'], decided: ['discount'] },
    ]);
    expect(adjustParentsOf(w.view.model, w.table('order_codes').table)).toEqual([{ order: id('orders'), orderKey: 'id', via: 'order_id', as: 'codes', inputs: ['order_id', 'typed', 'removed_at'], decided: ['code_id', 'voucher_id'] }]);
    expect(adjustParentsOf(w.view.model, w.table('items').table)).toEqual([]);
    expect(adjustParentsOf(w.view.model, w.orders.table)).toEqual([]);
  });

  it('a rule whose link to its order the database no longer has makes its rows part of nothing', () => {
    const unlinked = { ...w.view.model, relations: w.view.model.relations.filter((relation) => relation.from.tableId !== id('order_lines')) };
    expect(adjustParentsOf(unlinked, w.table('order_lines').table)).toEqual([]);
    expect(adjustParentsOf(unlinked, w.table('order_codes').table)).toHaveLength(1);
  });

  it('ride the rules every write of the table reads, with the columns only Adminium writes', () => {
    expect(rulesOf(w, 'orders')?.adjust?.addOn).toBe('price-kit');
    expect(rulesOf(w, 'orders')?.adjustParents).toBeUndefined();
    expect(rulesOf(w, 'orders')?.priced).toEqual(['discount', 'staff_by', 'customer_proved']);
    expect(rulesOf(w, 'order_lines')?.adjustParents?.[0]).toMatchObject({ as: 'line', order: id('orders') });
    expect(rulesOf(w, 'order_lines')?.priced).toEqual(['discount']);
    expect(rulesOf(w, 'order_codes')?.priced).toEqual(['code_id', 'voucher_id']);
    expect(rulesOf(w, 'items')?.priced).toBeUndefined();
    expect(rulesOf(w, 'items')?.adjust).toBeUndefined();
  });

  it('no writer sets a reduction or a code\'s link — but an import, which brings in history as it was', () => {
    const lines = rulesOf(w, 'order_lines');
    expect(withoutReadOnly(lines, { qty: 2, discount: '9.00' }, 'dashboard')).toEqual({ qty: 2 });
    expect(withoutReadOnly(lines, { qty: 2, discount: '9.00' }, 'public')).toEqual({ qty: 2 });
    expect(withoutReadOnly(lines, { qty: 2, discount: '9.00' }, 'import')).toEqual({ qty: 2, discount: '9.00' });
    expect(withoutReadOnly(rulesOf(w, 'orders'), { note: 'x', discount: '1.00', staff_by: 'usr_eve', customer_proved: true, staff_value: '10' }, 'dashboard')).toEqual({ note: 'x', staff_value: '10' });
    expect(withoutReadOnly(rulesOf(w, 'order_codes'), { typed: 'WELCOME10', code_id: 4, voucher_id: 9 }, 'public')).toEqual({ typed: 'WELCOME10' });
  });
});

describe('small questions a write asks of the rule', () => {
  const adjust = compileAdjust(world().orders.table)!;

  it('an order\'s price stands for good from the states the rule names', () => {
    expect(frozenNow(adjust, { status: 'paid' }, 'status')).toBe(true);
    expect(frozenNow(adjust, { status: 'placed' }, 'status')).toBe(false);
    // With no states column to read, nothing is frozen.
    expect(frozenNow(adjust, { status: 'paid' }, undefined)).toBe(false);
    expect(frozenNow({ rule: { ...adjust.rule, frozen: { column: 'closed', in: ['yes', 'final'] } } }, { closed: 'final' }, 'status')).toBe(true);
    expect(frozenNow({ rule: { ...adjust.rule, frozen: { column: 'closed', in: ['yes'] } } }, { closed: 'no' }, 'status')).toBe(false);
    expect(frozenNow({ rule: { ...adjust.rule, frozen: { column: 'paid_at', set: true } } }, { paid_at: '2026-09-30T10:00:00Z' }, undefined)).toBe(true);
    expect(frozenNow({ rule: { ...adjust.rule, frozen: { column: 'paid_at', set: true } } }, { paid_at: null }, undefined)).toBe(false);
    const { frozen: _frozen, ...never } = adjust.rule;
    expect(frozenNow({ rule: never }, { status: 'paid' }, 'status')).toBe(false);
  });

  it('a voided row, and a row of another kind, is no line', () => {
    const part = adjust.parts[0]!;
    expect(isLine(part, { kind: 'item', voided_at: null })).toBe(true);
    expect(isLine(part, { kind: 'extra', voided_at: null })).toBe(true);
    expect(isLine(part, { kind: 'item', voided_at: '2026-09-30T09:00:00Z' })).toBe(false);
    expect(isLine(part, { kind: 'fee', voided_at: null })).toBe(false);
    expect(isLine({ only: { column: 'on', eq: true } }, { on: 1 })).toBe(true);
    expect(isLine({ only: { column: 'on', eq: true } }, { on: 0 })).toBe(false);
    expect(isLine({}, {})).toBe(true);
  });

  it('a line\'s key carries its part, and a change touches the price only through the rule\'s columns', () => {
    expect(lineKey(0, 41)).toBe('p0:41');
    expect(lineKey(2, 'ab-1')).toBe('p2:ab-1');
    expect(touched(adjust.parts[0]!.inputs, { qty: 3, note: 'x' })).toEqual(['qty']);
    expect(touched(adjust.parts[0]!.inputs, { note: 'x' })).toEqual([]);
    expect(touched(adjust.inputs.uses, null)).toEqual([]);
  });
});

const DECIDER = { key: 'price-kit', version: '1.0.0', sha256: 'x', kinds: ['adjust'] } as unknown as InstalledDecider;

function runtime(over: { addOn?: Partial<InstalledAddOn> | null; decider?: InstalledDecider | null; feature?: boolean; maker?: string | null; tables?: string[] } = {}) {
  const addOn: InstalledAddOn | null = over.addOn === null ? null : { manifest: KIT, version: '1.0.0', status: 'installed', hosts: new Map([['market', true]]), ...over.addOn };
  const installs: AddOnInstalls = {
    installed: (connectionId, addOnKey) => (connectionId === 'cnx' && addOnKey === 'price-kit' ? addOn : null),
    tableOf: (_connectionId, addOnKey, ref) => (addOnKey === 'price-kit' && (over.tables ?? KIT_TABLES).includes(ref) ? kitId(ref) : null),
    // The shop made its tables; `maker: null` says nobody did.
    refOf: (_connectionId, tableId) => (over.maker === null || !tableId.startsWith('public.market_') ? tableId : `${over.maker ?? 'market'}:${tableId.slice('public.market_'.length)}`),
    tableOfRef: () => null,
    featureOn: () => over.feature !== false,
  };
  return createLedgerRuntime({ installs: () => installs, decider: () => null, adjustDecider: () => (over.decider === undefined ? DECIDER : over.decider), versionNow: async () => ({ version: '1.0.0', status: 'installed' }) });
}

const switched = (rows: SchemaOverride[]): SchemaOverride => ({ ...rows.find((row) => row.op === 'table.adjust')!, id: 'ovr_switch', op: 'table.switchedOff', origin: 'user', value: { postings: [], adjust: true } });

describe('whether a price rule is live', () => {
  it('live: the add-on with its tables as they are here, what it declares, and the code that answers', () => {
    const w = world();
    const answer = runtime().adjuster!(w.view, w.orders);
    if (answer.state !== 'live') throw new Error(JSON.stringify(answer));
    expect(answer.decider).toBe(DECIDER);
    expect(answer.adjuster).toMatchObject({ addOn: 'price-kit', version: '1.0.0' });
    expect(answer.adjuster.declared.codes).toMatchObject({ table: 'codes', column: 'code', reserved: ['GC', 'VC', 'PK'] });
    expect(answer.adjuster.table('offers')?.id).toBe(kitId('offers'));
    expect(answer.adjuster.table('ghosts')).toBeNull();
    expect(answer.adjuster.settings?.id).toBe(kitId('settings'));
    expect(answer.adjuster.refOf(kitId('applied'))).toBe('applied');
    expect(answer.adjuster.refOf(id('orders'))).toBe(id('orders'));
    // What the manifest says a column is, where an engine may not: json as text, money as a decimal.
    expect(Object.fromEntries(answer.adjuster.typesOf(kitId('offers')))).toMatchObject({ public_name: 'json', value: 'decimal', min_spend: 'decimal', first_order_only: 'boolean', starts_on: 'date' });
  });

  it('a table with no price rule is asked nothing', () => {
    const w = world();
    expect(runtime().adjuster!(w.view, w.table('items'))).toEqual({ state: 'idle' });
  });

  it('not installed in this database: the rule reads as not there', () => {
    const w = world();
    expect(runtime({ addOn: null }).adjuster!(w.view, w.orders)).toEqual({ state: 'idle' });
  });

  it('an app\'s rule for an add-on not connected to that app is inert; the owner\'s own rule on the same table is not', () => {
    const elsewhere = runtime({ addOn: { hosts: new Map([['kiosk', true]]) } });
    const apps = world();
    expect(elsewhere.adjuster!(apps.view, apps.orders)).toEqual({ state: 'idle' });
    const owners = world({ origin: 'user' });
    expect(elsewhere.adjuster!(owners.view, owners.orders).state).toBe('live');
    // An owner's rule on a table nobody made is the owner's too.
    expect(runtime({ addOn: { hosts: new Map() }, maker: null }).adjuster!(owners.view, owners.orders).state).toBe('live');
  });

  it('switched off for the app, or its feature not on: it cannot answer — never skipped', () => {
    const w = world();
    expect(runtime({ addOn: { hosts: new Map([['market', false]]) } }).adjuster!(w.view, w.orders)).toEqual({ state: 'unavailable', cause: 'switched-off-for-app' });
    expect(runtime({ feature: false }).adjuster!(w.view, w.orders)).toEqual({ state: 'unavailable', cause: 'switched-off-for-app' });
    // The owner's own rule has no app to be switched off for, and no feature to wait on.
    const owners = world({ origin: 'user' });
    expect(runtime({ addOn: { hosts: new Map([['market', false]]) }, feature: false }).adjuster!(owners.view, owners.orders).state).toBe('live');
  });

  it('being updated, disabled, with no code to ask, or with a table gone: it cannot answer, and says why', () => {
    const w = world();
    for (const status of ['updating', 'disabled', 'error', 'installing'] as const) {
      expect(runtime({ addOn: { status } }).adjuster!(w.view, w.orders)).toEqual({ state: 'unavailable', cause: status });
    }
    expect(runtime({ decider: null }).adjuster!(w.view, w.orders)).toEqual({ state: 'unavailable', cause: 'no-decider' });
    expect(runtime({ decider: { ...DECIDER, version: '0.9.0' } as InstalledDecider }).adjuster!(w.view, w.orders)).toEqual({ state: 'unavailable', cause: 'version-moved' });
    // An add-on that answers no price at all (an older version of it, say).
    const { adjuster: _adjuster, ...plain } = KIT.addOn;
    expect(runtime({ addOn: { manifest: { ...KIT, addOn: plain } as AddOnManifest } }).adjuster!(w.view, w.orders)).toEqual({ state: 'unavailable', cause: 'no-adjuster' });
    // One of the tables it reads is not in this database (dropped by hand, say).
    for (const gone of ['offers', 'codes', 'vouchers', 'applied', 'group_members', 'redemptions', 'ceilings', 'settings']) {
      const tables = KIT_TABLES.filter((ref) => ref !== gone);
      const short = world({ kitTables: tables });
      expect(runtime({ tables }).adjuster!(short.view, short.orders), gone).toEqual({ state: 'unavailable', cause: 'tables-missing' });
    }
  });

  it('a rule that names what is not here is never half-run', () => {
    const adjust = (change: (rule: Doc) => Doc) => {
      const w = world();
      const row = w.rows.find((candidate) => candidate.op === 'table.adjust')!;
      const changed = world({ more: [{ ...row, id: 'ovr_changed', value: change(structuredClone(row.value)) }] });
      return runtime().adjuster!(changed.view, changed.orders);
    };
    const invalid = { state: 'unavailable', cause: 'rule-invalid' };
    expect(adjust((rule) => rule).state).toBe('live');
    expect(adjust((rule) => ({ ...rule, expect: 'grand_total' }))).toEqual(invalid);
    expect(adjust((rule) => ({ ...rule, uses: 'redeem' }))).toEqual(invalid);
    expect(adjust((rule) => ({ ...rule, frozen: { to: ['shipped'] } }))).toEqual(invalid);
    // The order that is its own line and the order's lines together: one column cannot hold both reductions.
    expect(adjust((rule) => ({ ...rule, lines: [...(rule['lines'] as Doc[]), { self: true, price: 'tax_rate', discount: 'discount', what: [] }] }))).toEqual(invalid);
    expect(adjust((rule) => ({ ...rule, lines: [...(rule['lines'] as Doc[]), { self: true, price: 'tax_rate', discount: 'staff_value', what: [] }] })).state).toBe('live');
    // Who is buying is read through a link to a table that keeps an address.
    expect(adjust((rule) => ({ ...rule, order: { ...(rule['order'] as Doc), customer: { ...((rule['order'] as Doc)['customer'] as Doc), link: 'note' } } }))).toEqual(invalid);
    expect(adjust((rule) => ({ ...rule, order: { ...(rule['order'] as Doc), customer: { ...((rule['order'] as Doc)['customer'] as Doc), address: 'phone' } } }))).toEqual(invalid);
    // The links a typed code fills must lead into the tables the add-on keeps its codes in.
    expect(adjust((rule) => ({ ...rule, codes: { ...(rule['codes'] as Doc), code: 'voucher_id' } }))).toEqual(invalid);
    expect(adjust((rule) => ({ ...rule, codes: { ...(rule['codes'] as Doc), voucher: 'typed' } }))).toEqual(invalid);
  });

  it('a row names its order by the order\'s own key, and is itself a row one key names', () => {
    const invalid = { state: 'unavailable', cause: 'rule-invalid' };
    // A line that names its order by a column that is not the order's key would be read under another order.
    for (const child of ['order_lines', 'order_codes']) {
      const elsewhere = world({ relink: (relation) => { if (relation.from.tableId === id(child) && relation.to.tableId === id('orders')) relation.to.columns = ['tax_rate']; } });
      expect(runtime().adjuster!(elsewhere.view, elsewhere.orders), child).toEqual(invalid);
      const twoKeys = world({ rekey: (table) => { if (table.id === id(child)) table.primaryKey = ['id', 'order_id']; } });
      expect(runtime().adjuster!(twoKeys.view, twoKeys.orders), child).toEqual(invalid);
    }
  });

  it('an add-on whose own columns are not all here, or that keeps codes and vouchers in one table, cannot answer', () => {
    const w = world();
    const declared = KIT.addOn.adjuster as Doc & { codes: Doc; vouchers: Doc; applied: { columns: Doc }; person: { uses: Doc }; ceilings: Doc; offers: Doc[] };
    const having = (adjuster: Doc) => runtime({ addOn: { manifest: { ...KIT, addOn: { ...KIT.addOn, adjuster } } as AddOnManifest } }).adjuster!(w.view, w.orders);
    expect(having(declared).state).toBe('live');
    const missing = { state: 'unavailable', cause: 'columns-missing' };
    expect(having({ ...declared, codes: { ...declared.codes, column: 'ghost' } })).toEqual(missing);
    expect(having({ ...declared, codes: { ...declared.codes, where: [{ column: 'ghost', eq: true }] } })).toEqual(missing);
    expect(having({ ...declared, vouchers: { ...declared.vouchers, column: 'ghost' } })).toEqual(missing);
    expect(having({ ...declared, applied: { ...declared.applied, columns: { ...declared.applied.columns, amount: 'ghost' } } })).toEqual(missing);
    expect(having({ ...declared, person: { ...declared.person, uses: { ...declared.person.uses, state: 'ghost' } } })).toEqual(missing);
    expect(having({ ...declared, ceilings: { ...declared.ceilings, comp: 'ghost' } })).toEqual(missing);
    expect(having({ ...declared, offers: [{ ...declared.offers[0]!, where: [{ column: 'ghost', eq: 1 }] }, declared.offers[1]!] })).toEqual(missing);
    expect(having({ ...declared, vouchers: { ...declared.vouchers, table: 'codes' } })).toEqual({ state: 'unavailable', cause: 'tables-clash' });
  });

  it('the owner\'s switch: off asks nothing and refuses nothing, and is the way through an add-on that cannot answer', () => {
    const w = world();
    const off = world({ more: [switched(w.rows)] });
    expect(runtime().adjuster!(off.view, off.orders)).toEqual({ state: 'off' });
    expect(runtime({ addOn: { status: 'updating' } }).adjuster!(off.view, off.orders)).toEqual({ state: 'off' });
    expect(runtime({ decider: null }).adjuster!(off.view, off.orders)).toEqual({ state: 'off' });
    expect(runtime({ addOn: { hosts: new Map([['market', false]]) } }).adjuster!(off.view, off.orders)).toEqual({ state: 'off' });
    // Not connected stays not there: the switch has nothing to switch.
    expect(runtime({ addOn: { hosts: new Map() } }).adjuster!(off.view, off.orders)).toEqual({ state: 'idle' });
    expect(runtime({ addOn: null }).adjuster!(off.view, off.orders)).toEqual({ state: 'idle' });
  });
});
