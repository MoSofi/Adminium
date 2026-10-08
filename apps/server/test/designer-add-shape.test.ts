// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD_ON_SHAPE, THE SECOND WAY — a shape that is added to tables the app
 * already has (an order that takes discounts, a payment a gift card makes),
 * against a real starter app on disk.
 *
 * The shapes are Offers' own, as its manifest declares them. The tool adds
 * the shape's columns and its rule to the app's tables under the app's names,
 * the requirement and the floor, writes no "builtOn", and writes nothing at
 * all when the app's own check refuses the result.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { createEventLog } from '../src/designer/events.js';
import type { AddOnGetter, AddOnLook } from '../src/designer/get-add-on.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools } from '../src/designer/tools.js';
import { runCli } from '../src/cli/run.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { hostAdjustIssue } from '../src/project/apps/ledger-parts.js';
import { adoptParts, spelledOut } from '../src/project/apps/shape-parts.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

/** Offers' shapes, ledger and adjuster as its manifest declares them (`test/add-ons/offers/designer.test.ts` holds this file to the built add-on). */
export const OFFERS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'offers-shapes.json'), 'utf8')) as Record<string, unknown>;

const VERSION = '0.3.19';
let root: string;
let asked: CardRequest[];
let answers: CardAnswer[];
let onServer: boolean;
let looks: AddOnLook;

const tools = (version = VERSION): DesignerTool[] =>
  createDesignerTools(
    {
      root,
      version,
      designer: () => ({ store: { messages: () => [] } }) as never,
      skills: createSkills(),
      listAddOns: async () => [],
      addOnGetter: {
        look: async () => (onServer ? { state: 'installed', name: 'Offers & gift cards', version: '1.0.9' } : looks),
        allowed: async () => true,
        switchOn: async () => ({ ok: true }),
        get: async () => {
          onServer = true;
          return { ok: true, name: 'Offers & gift cards', version: '1.0.9' };
        },
      } satisfies AddOnGetter,
      readAddOn: async (key) => (key === 'offers' ? OFFERS : null),
    },
    'till',
  );
const context = (): ToolContext => {
  const signal = new AbortController().signal;
  const ask = async (card: CardRequest): Promise<CardAnswer> => {
    asked.push(card);
    const answer = answers.shift();
    if (answer === undefined) throw new Error('nobody answered');
    return answer;
  };
  const session = { id: 'ds_000000000000000000000000', appKey: 'till' } as DesignerSession;
  return { session, turn: 1, signal, ask, handle: { turn: 1, by: { id: null, label: 'x' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) } };
};
const build = (input: Record<string, unknown>, version = VERSION) =>
  tools(version)
    .find((tool) => tool.name === 'build_on_shape')!
    .run({ add_on: 'offers', ...input }, context());
const file = (name: string) => join(root, 'apps/till/manifest', name);
const json = (name: string) => JSON.parse(readFileSync(file(name), 'utf8')) as Record<string, unknown>;
const put = (name: string, value: unknown) => writeFileSync(file(name), JSON.stringify(value, null, 2));
const columns = (table: string) => (json(`tables/${table}.json`)['columns'] as { ref: string }[]).map((column) => column.ref);
const errors = () => checkApp(root, 'till', { version: VERSION }).findings.filter((finding) => finding.level === 'error').map((finding) => `${finding.file} · ${finding.path} · ${finding.message}`);

const pk = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'money', scale: 'currency', nullable: true });
/** A till as a model writes it first: tickets with their states, lines and payments, nothing about Offers. */
const TICKETS = {
  ref: 'tickets',
  label: { 'en-US': 'Ticket' },
  labelPlural: { 'en-US': 'Tickets' },
  keyField: 'id',
  columns: [pk, { ref: 'status', type: 'enum', enum: ['open', 'paid', 'void'], default: 'open' }],
  states: { column: 'status', initial: 'open', moves: { open: ['paid', 'void'], paid: ['void'] } },
};
const LINES = { ref: 'ticket_lines', label: { 'en-US': 'Line' }, labelPlural: { 'en-US': 'Lines' }, keyField: 'id', columns: [pk, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, { ref: 'item_id', type: 'fk', references: 'items', nullable: true }, money('line_total')] };
const PAYMENTS = { ref: 'payments', label: { 'en-US': 'Payment' }, labelPlural: { 'en-US': 'Payments' }, keyField: 'id', columns: [pk, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, money('amount')] };
const PAID = { post: { to: ['paid'] }, reverse: { to: ['void'], from: ['paid'] } };
const till = () => {
  // The starter app's own `items` are what a line sells.
  put('tables/tickets.json', TICKETS);
  put('tables/ticket_lines.json', LINES);
  put('tables/payments.json', PAYMENTS);
  expect(errors()).toEqual([]);
};

beforeEach(async () => {
  root = tempProject('adminium-designer-shape-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'till'], { io, deps }), io.stderr()).toBe(0);
  asked = [];
  answers = [];
  onServer = true;
  looks = { state: 'here', name: 'Offers & gift cards', version: '1.0.9', line: 'Discounts, codes, vouchers and gift cards.', tables: 21 };
  expect(errors()).toEqual([]);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('build_on_shape, for a shape added to the app\'s own tables', () => {
  it('knows which way a shape is built', () => {
    for (const shape of ['discountable@1', 'card-payment@1', 'card-sale@1', 'voucher-sale@1']) expect(spelledOut(OFFERS, shape), shape).toBe(true);
    expect(spelledOut(OFFERS, 'nothing@1')).toBe(false);
    expect(spelledOut({ addOn: { shapes: [{ name: 'invoice', version: 1, parts: { document: { columns: [] } } }] } }, 'invoice@1')).toBe(false);
  });

  it('a line that sells a gift card: its columns and rule on the app\'s lines, at the app\'s own moments, with no builtOn', async () => {
    till();
    put('app.json', { ...json('app.json'), compatibility: { minAdminiumVersion: '0.3.18' } });
    const done = await build({ shape: 'card-sale@1', tables: { 'card-sale@1/order': 'tickets', 'card-sale@1/lines': 'ticket_lines' }, when: PAID });
    expect(done.isError, done.content).toBeUndefined();
    expect(done.label).toBe('Added card-sale@1');
    expect(columns('ticket_lines')).toEqual(['id', 'ticket_id', 'item_id', 'line_total', 'gift_card_id', 'load_amount']);
    // The app's own states say when: the shape's date columns are not this app's.
    expect(columns('tickets')).toEqual(['id', 'status']);
    const lines = json('tables/ticket_lines.json');
    expect(lines['builtOn']).toBeUndefined();
    expect(lines['part']).toBeUndefined();
    expect(json('tables/tickets.json')['builtOn']).toBeUndefined();
    expect(lines['postings']).toEqual([
      { id: 'card-load', into: { addOn: 'offers', ledger: 'value', action: 'issue' }, via: 'ticket_id', map: { card: 'gift_card_id', amount: 'load_amount' }, post: { on: { to: ['paid'] } }, reverse: { on: { to: ['void'], from: ['paid'] } } },
    ]);
    expect((lines['columns'] as { ref: string; rules?: unknown }[]).find((column) => column.ref === 'gift_card_id')).toMatchObject({ type: 'int', nullable: true, rules: { addOnLink: { addOn: 'offers', table: 'gift_cards' } } });
    expect(json('add-ons.json')['requires']).toEqual([expect.objectContaining({ key: 'offers', range: '>=1.0.9' })]);
    // The first Adminium the add-on itself runs on.
    expect((json('app.json')['compatibility'] as { minAdminiumVersion: string }).minAdminiumVersion).toBe('0.3.19');
    expect(done.content).toContain('apps/till/manifest/tables/ticket_lines.json: added gift_card_id (int, a link to offers.gift_cards), load_amount (money); the rule "card-load" posts into offers/value (issue)');
    expect(done.content).toContain('apps/till/manifest/tables/tickets.json: no column added');
    expect(done.content).toContain('"tables" on the role');
    expect(errors()).toEqual([]);
  });

  it('a payment a card makes: a paired column is used, not added, and the column its moment names is added on the payment', async () => {
    till();
    const done = await build({
      shape: 'card-payment@1',
      tables: { 'card-payment@1/order': 'tickets', 'card-payment@1/payments': 'payments' },
      columns: { amount: 'amount' },
      when: { post: { create: true }, reverse: { column: 'voided_at', set: true } },
    });
    expect(done.isError, done.content).toBeUndefined();
    expect(columns('payments')).toEqual(['id', 'ticket_id', 'amount', 'card_code', 'card_id', 'card_last4', 'card_balance_after', 'voided_at']);
    expect(columns('tickets')).toEqual(['id', 'status', 'due']);
    expect(json('tables/payments.json')['postings']).toEqual([
      {
        id: 'card',
        into: { addOn: 'offers', ledger: 'value', action: 'spend' },
        via: 'ticket_id',
        map: { card: 'card_id', due: { parent: 'due' }, amount: 'amount', balance_after: 'card_balance_after' },
        post: { on: { create: true } },
        // The payment's own change, not the ticket's.
        reverse: { on: { column: 'voided_at', set: true, own: true } },
      },
    ]);
    expect(errors()).toEqual([]);
  });

  it('an order that takes discounts: the app\'s own columns stand for the shape\'s in every rule, and the codes table is written new', async () => {
    till();
    const done = await build({
      shape: 'discountable@1',
      tables: { 'discountable@1/order': 'tickets', 'discountable@1/lines': 'ticket_lines', 'discountable@1/codes': 'ticket_codes' },
      columns: { 'lines.amount': 'line_total', 'lines.item': 'item_id' },
    });
    expect(done.isError, done.content).toBeUndefined();
    const tickets = json('tables/tickets.json');
    // No moment given: the shape's own date columns are added, and its rule reads them.
    expect(columns('tickets')).toEqual(['id', 'status', 'subtotal', 'discount', 'net', 'discount_kind', 'discount_value', 'discount_reason', 'discount_by', 'paid_at', 'cancelled_at']);
    expect(columns('ticket_lines')).toEqual(['id', 'ticket_id', 'item_id', 'line_total', 'discount']);
    expect(columns('ticket_codes')).toEqual(['id', 'ticket_id', 'typed', 'code_id', 'voucher_id', 'removed_at']);
    expect(tickets['adjust']).toEqual({
      by: { addOn: 'offers' },
      lines: [{ table: 'ticket_lines', via: 'ticket_id', price: 'line_total', discount: 'discount', what: [{ column: 'item_id', as: 'item' }] }],
      order: { discount: 'discount', staff: { kind: 'discount_kind', value: 'discount_value', reason: 'discount_reason', by: 'discount_by' } },
      codes: { table: 'ticket_codes', via: 'ticket_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id', removed: 'removed_at' },
      uses: 'uses',
    });
    expect(tickets['postings']).toEqual([
      { id: 'uses', into: { addOn: 'offers', ledger: 'value', action: 'redeem' }, map: { reason: 'discount_reason' }, post: { on: { column: 'paid_at', set: true } }, reverse: { on: { column: 'cancelled_at', set: true } } },
    ]);
    // The sum of the lines reads the app's own amount, through the app's own link.
    expect((tickets['columns'] as { ref: string; rules?: { rollup?: unknown } }[]).find((column) => column.ref === 'subtotal')?.rules?.rollup).toEqual({ from: 'ticket_lines', via: 'ticket_id', sum: 'line_total' });
    expect(done.content).toContain('apps/till/manifest/tables/ticket_codes.json (new)');
    expect(done.content).toContain('uses item_id as item, line_total as amount');
    expect(errors()).toEqual([]);

    // Called again, it replaces its own rule and adds nothing twice.
    const again = await build({
      shape: 'discountable@1',
      tables: { 'discountable@1/order': 'tickets', 'discountable@1/lines': 'ticket_lines', 'discountable@1/codes': 'ticket_codes' },
      columns: { 'lines.amount': 'line_total', 'lines.item': 'item_id' },
    });
    expect(again.isError, again.content).toBeUndefined();
    expect(json('tables/tickets.json')).toEqual(tickets);
    expect(columns('ticket_codes')).toEqual(['id', 'ticket_id', 'typed', 'code_id', 'voucher_id', 'removed_at']);
  });

  it('a line that loads a card, or sells a voucher, takes no reduction: the price rule says so, whichever shape came first', async () => {
    const line = () => ((json('tables/tickets.json')['adjust'] as { lines: Record<string, unknown>[] }).lines[0])!;
    const discounts = () => build({ shape: 'discountable@1', tables: { order: 'tickets', lines: 'ticket_lines', codes: 'ticket_codes' }, columns: { 'lines.amount': 'line_total', 'lines.item': 'item_id' }, when: PAID });
    const cards = () => build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, when: PAID });
    const vouchers = () => build({ shape: 'voucher-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, columns: { amount: 'line_total' }, when: PAID });

    // The price rule first, then the two sales: each tells the rule that is already there.
    till();
    expect((await discounts()).isError).toBeUndefined();
    expect(line()['excludes']).toBeUndefined();
    const sold = await cards();
    expect(sold.content).toContain('apps/till/manifest/tables/tickets.json: its price rule\'s lines of "ticket_lines" now say "excludes": a line that fills gift_card_id takes no reduction');
    expect(line()).toMatchObject({ excludes: { column: 'gift_card_id', set: true } });
    expect((await vouchers()).content).toContain('now say "paidBy": a line that fills voucher_id is something sold, and takes no reduction');
    expect(line()).toMatchObject({ excludes: { column: 'gift_card_id', set: true }, paidBy: { column: 'voucher_id' } });
    // The price rule written again keeps both.
    const again = await discounts();
    expect(again.content).toContain('its lines of "ticket_lines" say "excludes" for gift_card_id; its lines of "ticket_lines" say "paidBy" for voucher_id');
    expect(line()).toMatchObject({ excludes: { column: 'gift_card_id', set: true }, paidBy: { column: 'voucher_id' } });
    // A sale added again changes nothing, and says nothing of the tickets.
    expect((await cards()).content).not.toContain('now say');
    expect(errors()).toEqual([]);

    // The sales first, under a column of the app's own name, then the price rule: it finds them by the rules they wrote.
    put('tables/tickets.json', TICKETS);
    put('tables/ticket_lines.json', { ...LINES, columns: [...LINES.columns, { ref: 'card', type: 'int', nullable: true }] });
    expect((await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, columns: { gift_card_id: 'card' }, when: PAID })).isError).toBeUndefined();
    expect((await discounts()).isError).toBeUndefined();
    expect(line()).toMatchObject({ excludes: { column: 'card', set: true } });
    expect(line()['paidBy']).toBeUndefined();
    expect(errors()).toEqual([]);
  });

  it('a link a model wrote as a whole number that names its table is the link; and the answer says which shapes are still not on the app', async () => {
    till();
    // As a real model wrote it: "type": "int" with "references", which installs as a link all the same.
    put('tables/payments.json', { ...PAYMENTS, columns: [pk, { ref: 'ticket_id', type: 'int', references: 'tickets' }, money('amount')] });
    expect(errors()).toEqual([]);
    const paid = await build({ shape: 'card-payment@1', tables: { order: 'tickets', payments: 'payments' }, columns: { amount: 'amount' }, when: { post: { create: true }, reverse: { column: 'voided_at', set: true } } });
    expect(paid.isError, paid.content).toBeUndefined();
    expect((json('tables/payments.json')['postings'] as { via: string }[])[0]!.via).toBe('ticket_id');
    expect((json('tables/payments.json')['columns'] as { ref: string; type: string }[])[1]).toMatchObject({ ref: 'ticket_id', type: 'fk', references: 'tickets' });
    expect(paid.content).toContain('ticket_id is now "type": "fk" (it named "tickets" as a whole number)');
    expect(paid.content).toContain('Not on this app yet: discountable@1, card-sale@1, voucher-sale@1. Each is a call of its own, with your tables; add the ones the person asked for before you apply.');
    // A part named in the singular, as the same model wrote it, is read as the part it means.
    const sold = await build({ shape: 'card-sale@1', tables: { 'card-sale@1/order': 'tickets', 'card-sale@1/line': 'ticket_lines' }, when: PAID });
    expect(sold.isError, sold.content).toBeUndefined();
    expect(sold.content).toContain('Not on this app yet: discountable@1, voucher-sale@1.');
    expect(errors()).toEqual([]);
  });

  it('with "suggests" the app runs without the add-on: a feature, and the rule live only under it', async () => {
    till();
    const done = await build({ shape: 'voucher-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, columns: { amount: 'line_total' }, when: PAID, need: 'suggests' });
    expect(done.isError, done.content).toBeUndefined();
    const needs = json('add-ons.json');
    expect(needs['requires'] ?? []).toEqual([]);
    expect(needs['suggests']).toEqual([expect.objectContaining({ key: 'offers', checked: true })]);
    expect(needs['features']).toEqual([{ id: 'offers', label: { 'en-US': 'Offers & gift cards' }, requires: ['offers'] }]);
    expect((json('tables/ticket_lines.json')['postings'] as { needs?: string; map: unknown }[])[0]).toMatchObject({ needs: 'offers', map: { voucher: 'voucher_id', amount: 'line_total', tax_later: 'tax_later' } });
    expect(errors()).toEqual([]);
  });

  it('says which table each part needs, by name, when none is given', async () => {
    till();
    const none = await build({ shape: 'discountable@1' });
    expect(none.isError).toBe(true);
    expect(none.content).toBe(
      'discountable@1 is added to tables the app already has. Give "tables": { "discountable@1/order": "<your orders table>", "discountable@1/lines": "<your lines table>", "discountable@1/codes": "<a new table’s name>" }. Nothing of discountable@1 is on the app until this call succeeds.',
    );
    expect((await build({ shape: 'card-payment@1', tables: { 'card-payment@1/order': 'tickets' } })).content).toContain('"card-payment@1/payments": "<your payments table>"');
  });

  it('refuses by name: a table that is not there, no link to the order, a column of the wrong kind, a name the shape does not have', async () => {
    till();
    const before = { tickets: json('tables/tickets.json'), lines: json('tables/ticket_lines.json') };
    const missing = await build({ shape: 'card-sale@1', tables: { order: 'orders', lines: 'ticket_lines' }, when: PAID });
    expect(missing.content).toBe('There is no table "orders" yet. Write apps/till/manifest/tables/orders.json first (the app\'s own orders, nothing about offers), then call this again. Nothing of card-sale@1 is on the app until this call succeeds.');

    put('tables/loose.json', { ref: 'loose', label: { 'en-US': 'Loose' }, labelPlural: { 'en-US': 'Loose' }, keyField: 'id', columns: [pk, { ref: 'gift_card_id', type: 'text', maxLength: 20, nullable: true }] });
    const unlinked = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'loose' }, when: PAID });
    expect(unlinked.content).toBe('apps/till/manifest/tables/loose.json has no link to "tickets". Add { "ref": "ticket_id", "type": "fk", "references": "tickets" } to its columns, then call this again. Nothing of card-sale@1 is on the app until this call succeeds.');

    put('tables/loose.json', { ref: 'loose', label: { 'en-US': 'Loose' }, labelPlural: { 'en-US': 'Loose' }, keyField: 'id', columns: [pk, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, { ref: 'gift_card_id', type: 'text', maxLength: 20, nullable: true }] });
    const typed = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'loose' }, when: PAID });
    expect(typed.content).toContain('"gift_card_id" is text in apps/till/manifest/tables/loose.json, and "gift_card_id" of card-sale@1 is a link to a row of offers.gift_cards: a whole number.');

    const stray = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, columns: { total: 'line_total' }, when: PAID });
    expect(stray.content).toContain('"total" in "columns" is not a column of card-sale@1. Its columns: order: paid_at, cancelled_at; lines: order_id, gift_card_id, load_amount.');

    const unsold = await build({ shape: 'discountable@1', tables: { order: 'tickets', lines: 'ticket_lines', codes: 'ticket_codes' }, columns: { 'lines.amount': 'line_total' } });
    expect(unsold.content).toBe(
      '"item" of discountable@1 says what a line sells: a link from your own table to the thing sold. Name the link column apps/till/manifest/tables/ticket_lines.json has (its "type" is "fk") in "columns": { "lines.item": "<column>" }. Nothing of discountable@1 is on the app until this call succeeds.',
    );
    expect(unsold.isError).toBe(true);

    const moment = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, when: { post: { column: 'settled_at', set: true } } });
    expect(moment.content).toContain('"settled_at" in "when.post" is not a column of apps/till/manifest/tables/ticket_lines.json or apps/till/manifest/tables/tickets.json.');
    for (const refusal of [missing, unlinked, typed, stray, moment]) expect(refusal.isError).toBe(true);
    expect(json('tables/tickets.json')).toEqual(before.tickets);
    expect(json('tables/ticket_lines.json')).toEqual(before.lines);
    expect(() => json('add-ons.json')).toThrow();
  });

  it('writes nothing when the app\'s own check refuses the result', async () => {
    till();
    const before = { lines: readFileSync(file('tables/ticket_lines.json'), 'utf8'), app: readFileSync(file('app.json'), 'utf8') };
    // A state the tickets do not have.
    const done = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, when: { post: { to: ['settled'] } } });
    expect(done.isError, done.content).toBe(true);
    expect(done.content).toContain('Nothing was written: with card-sale@1 in place the app\'s check says');
    expect(readFileSync(file('tables/ticket_lines.json'), 'utf8')).toBe(before.lines);
    expect(readFileSync(file('app.json'), 'utf8')).toBe(before.app);
    expect(() => json('add-ons.json')).toThrow();
    expect(errors()).toEqual([]);
  });

  it('a server older than the add-on runs on is told so, and nothing is written', async () => {
    till();
    const done = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, when: PAID }, '0.3.18');
    expect(done).toMatchObject({ isError: true, content: 'This server is Adminium 0.3.18, and Offers & gift cards needs 0.3.19 or later. Tell the person; build the app without it.' });
    expect(columns('ticket_lines')).toEqual(['id', 'ticket_id', 'item_id', 'line_total']);
  });

  it('asks for the add-on on the way when it is not installed, once', async () => {
    till();
    onServer = false;
    answers = [{ type: 'add-on', accept: true }];
    const done = await build({ shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, when: PAID });
    expect(done.isError, done.content).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ type: 'add-on', here: true });
  });
});

describe('the parts themselves', () => {
  it('two parts never share a table, and a part is one of the shape\'s', () => {
    const have = { tickets: TICKETS, ticket_lines: LINES };
    expect(adoptParts({ addOn: 'offers', document: OFFERS, shape: 'card-sale@1', tables: { order: 'tickets', lines: 'tickets' }, have })).toMatchObject({ ok: false, problem: expect.stringContaining('Two parts would both be the table "tickets"') });
    expect(adoptParts({ addOn: 'offers', document: OFFERS, shape: 'card-sale@1', tables: { order: 'tickets', rows: 'ticket_lines' }, have })).toMatchObject({ ok: false, problem: expect.stringContaining('"rows" is not a part of card-sale@1. Its parts: order, lines.') });
    expect(adoptParts({ addOn: 'offers', document: OFFERS, shape: 'gift@1', tables: {}, have })).toMatchObject({ ok: false, problem: expect.stringContaining('Its shapes: discountable@1, card-payment@1, card-sale@1, voucher-sale@1.') });
  });

  it('a step the action does not have is refused, and a moment that is no moment', () => {
    const have = { tickets: TICKETS, ticket_lines: LINES };
    const tables = { order: 'tickets', lines: 'ticket_lines' };
    expect(adoptParts({ addOn: 'offers', document: OFFERS, shape: 'card-sale@1', tables, have, when: { reserve: { create: true } } })).toMatchObject({ ok: false, problem: 'offers/value/issue has no "reserve". It takes: post, reverse. Give "when" for those.' });
    expect(adoptParts({ addOn: 'offers', document: OFFERS, shape: 'card-sale@1', tables, have, when: { post: { whenever: true } } })).toMatchObject({ ok: false, problem: expect.stringContaining('"when.post" is not a moment a rule fires at.') });
  });

  it('a column the table has for a link is given the link, and one that points into the app is refused', () => {
    const lines = { ...LINES, columns: [...LINES.columns, { ref: 'gift_card_id', type: 'int', default: 0 }] };
    const given = adoptParts({ addOn: 'offers', document: OFFERS, shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, have: { tickets: TICKETS, ticket_lines: lines }, when: PAID });
    if (!given.ok) throw new Error(given.problem);
    expect(given.tables.find((table) => table.part === 'lines')?.added).toEqual([{ column: 'gift_card_id', type: 'int', links: 'offers.gift_cards', given: true }, { column: 'load_amount', type: 'money' }]);
    expect((given.files['tables/ticket_lines.json']!['columns'] as { ref: string }[]).find((column) => column.ref === 'gift_card_id')).toEqual({ ref: 'gift_card_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'offers', table: 'gift_cards' } } });
    const own = { ...LINES, columns: [...LINES.columns, { ref: 'gift_card_id', type: 'int', references: 'items' }] };
    expect(adoptParts({ addOn: 'offers', document: OFFERS, shape: 'card-sale@1', tables: { order: 'tickets', lines: 'ticket_lines' }, have: { tickets: TICKETS, ticket_lines: own }, when: PAID })).toMatchObject({ ok: false, problem: expect.stringContaining('has "references"') });
  });
});

describe('a price rule against the add-on it asks', () => {
  type Ruled = Parameters<typeof hostAdjustIssue>[0];
  const written = (): Ruled[] => {
    const made = adoptParts({
      addOn: 'offers',
      document: OFFERS,
      shape: 'discountable@1',
      tables: { order: 'tickets', lines: 'ticket_lines', codes: 'ticket_codes' },
      have: { tickets: TICKETS, ticket_lines: LINES },
      columns: { 'lines.amount': 'line_total', 'lines.item': 'item_id' },
    });
    if (!made.ok) throw new Error(made.problem);
    return Object.values(made.files) as unknown as Ruled[];
  };
  const judged = (change: (tables: Ruled[]) => void, document: unknown = OFFERS): string | null => {
    const tables = structuredClone(written());
    change(tables);
    return hostAdjustIssue(tables.find((table) => table.ref === 'tickets')!, tables, document);
  };

  it('what the tool writes fits', () => {
    expect(judged(() => undefined)).toBeNull();
  });

  it('an add-on that answers no price is said so', () => {
    expect(judged(() => undefined, { addOn: { ledgers: [] } })).toBe('"offers" answers no price question: it is not an add-on an "adjust" rule can name. Take "adjust" out of this file; list_add_ons says what each add-on offers.');
  });

  it('a typed code\'s link that goes elsewhere, and a record of uses that is not the order\'s own posting', () => {
    const codes = (tables: Ruled[]) => tables.find((table) => table.ref === 'ticket_codes')!;
    const tickets = (tables: Ruled[]) => tables.find((table) => table.ref === 'tickets')!;
    expect(judged((tables) => void ((codes(tables).columns.find((column) => column.ref === 'code_id') as { rules: unknown }).rules = { addOnLink: { addOn: 'offers', table: 'vouchers' } }))).toBe(
      '"code_id" of ticket_codes is the link a typed code fills: it must link into offers.codes. Call build_on_shape for this table again; do not edit the rule by hand.',
    );
    expect(judged((tables) => void ((tickets(tables) as { postings: unknown }).postings = []))).toContain('"uses" is not a posting of tickets');
    expect(judged((tables) => void ((tickets(tables).postings as unknown as { into: { addOn: string } }[])[0]!.into.addOn = 'inventory'))).toContain('goes into "inventory", not into "offers"');
    expect(judged((tables) => void ((tickets(tables).postings as unknown as { via?: string }[])[0]!.via = 'ticket_id'))).toContain('is a line\'s');
  });
});
