// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ADMINIUM DESIGNER WRITES FOR A TILL, RUN ON OFFERS AS BUILT.
 *
 * A till's tickets, lines and payments as a model writes them first, with
 * nothing about Offers. Every column and rule Offers needs is then added by
 * the Designer's tool from the add-on's own manifest — nothing here names an
 * input by hand — and the till is run the whole way through a real write
 * service: a typed code comes off a ticket and is counted when it is paid, a
 * gift card pays, a line loads a card.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shapesOf } from '../../../src/designer/add-on-lines.js';
import { hostAdjustIssue, hostPostingIssue } from '../../../src/project/apps/ledger-parts.js';
import { adoptParts } from '../../../src/project/apps/shape-parts.js';
import { priceWorld } from '../../adjust.helpers.js';
import { saveWorld, type SaveWorld } from '../../adjust-save.helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { money2, offers, shopManifest } from './world.js';

type Doc = Record<string, unknown>;
const FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'offers-shapes.json'), 'utf8')) as { addOn: Doc; version: string };

const pk = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, more: Doc = {}) => ({ ref, type: 'money', scale: 'currency', ...more });
/** The till before the tool: what a model writes of its own. */
const BARE: Record<string, Doc> = {
  tickets: {
    ref: 'tickets',
    states: { column: 'status', initial: 'open', moves: { open: ['paid', 'void'], paid: ['void'] } },
    columns: [pk, { ref: 'status', type: 'enum', enum: ['open', 'paid', 'void'], default: 'open' }],
  },
  ticket_lines: {
    ref: 'ticket_lines',
    columns: [
      pk,
      { ref: 'ticket_id', type: 'fk', references: 'tickets' },
      { ref: 'item_id', type: 'fk', references: 'items', nullable: true },
      money('unit_price', { default: 0 }),
      { ref: 'qty', type: 'int', default: 1 },
      money('line_total', { nullable: true, rules: { formula: { mul: ['unit_price', 'qty'] } } }),
    ],
  },
  payments: { ref: 'payments', columns: [pk, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, money('amount', { default: 0 })] },
};
const PAID = { post: { to: ['paid'] }, reverse: { to: ['void'], from: ['paid'] } };

/** The four shapes, added one after another as four calls of the tool would. */
function built(document: unknown): { tables: Record<string, Doc>; problems: string[] } {
  const have: Record<string, Doc> = structuredClone(BARE);
  const problems: string[] = [];
  const add = (shape: string, tables: Record<string, string>, more: { columns?: Record<string, string>; when?: Doc } = {}) => {
    // The world installs the app before the add-on, as a shop that came first: the rules are live under a feature.
    const made = adoptParts({ addOn: 'offers', document, shape, tables, have, need: 'suggests', ...more });
    if (!made.ok) return void problems.push(`${shape}: ${made.problem}`);
    for (const file of Object.values(made.files)) have[String(file['ref'])] = file;
  };
  add('discountable@1', { order: 'tickets', lines: 'ticket_lines', codes: 'ticket_codes' }, { columns: { 'lines.amount': 'line_total', 'lines.item': 'item_id' }, when: PAID });
  add('card-sale@1', { order: 'tickets', lines: 'ticket_lines' }, { when: PAID });
  add('voucher-sale@1', { order: 'tickets', lines: 'ticket_lines' }, { columns: { amount: 'line_total' }, when: PAID });
  add('card-payment@1', { order: 'tickets', payments: 'payments' }, { columns: { amount: 'amount' }, when: { post: { create: true }, reverse: { column: 'voided_at', set: true } } });
  return { tables: have, problems };
}

const made = offers === null ? null : built(offers.manifest);
const till = (): Doc => {
  const shop = shopManifest();
  return {
    ...shop,
    key: 'till',
    name: 'Till',
    compatibility: { minAdminiumVersion: '0.3.19', engines: ['postgres', 'mysql', 'sqlite'] },
    pages: [{ ref: 'till-tickets', template: 'page-crud', title: { key: 'mft.till.page.tickets', fallback: 'Tickets' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'tickets' } }],
    requiredSchema: { prefixed: true, tables: [{ ref: 'items', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }] }, ...Object.values(made!.tables)] },
  };
};

describe('what the tool reads of Offers', () => {
  const run = offers !== null;

  it.skipIf(!run)('the file the engine\'s own tests read is the built add-on\'s', () => {
    const real = offers!.manifest['addOn'] as Doc;
    expect(FIXTURE.addOn['shapes']).toEqual(real['shapes']);
    expect(FIXTURE.addOn['ledgers']).toEqual(real['ledgers']);
    expect(FIXTURE.addOn['adjuster']).toEqual(real['adjuster']);
    expect(FIXTURE.version).toBe(offers!.version);
  });

  it.skipIf(!run)('all four of its shapes are ones added to an app\'s own tables', () => {
    expect(shapesOf(offers!.manifest)).toEqual(['discountable@1', 'card-payment@1', 'card-sale@1', 'voucher-sale@1'].map((name) => ({ name, how: 'spelled-out' })));
  });

  it.skipIf(!run)('the four go onto one till, and every rule written fits the add-on', () => {
    expect(made!.problems).toEqual([]);
    const tables = Object.values(made!.tables) as never as Parameters<typeof hostAdjustIssue>[1];
    for (const table of tables) {
      expect(hostAdjustIssue(table, tables, offers!.manifest), table.ref).toBeNull();
      for (const posting of (table.postings ?? []) as never[]) expect(hostPostingIssue(posting, offers!.manifest), table.ref).toBeNull();
    }
    expect((made!.tables['ticket_lines']!['postings'] as { id: string }[]).map((posting) => posting.id)).toEqual(['card-load', 'voucher-sold']);
    expect((made!.tables['ticket_lines']!['columns'] as { ref: string }[]).map((column) => column.ref)).toEqual(['id', 'ticket_id', 'item_id', 'unit_price', 'qty', 'line_total', 'discount', 'gift_card_id', 'load_amount', 'voucher_id', 'tax_later']);
  });
});

describe.each(LEGS)('a till the tool wrote, on Offers — %s', (dialect, available) => {
  const run = available && offers !== null && made !== null && made.problems.length === 0;
  let w: SaveWorld;
  let mug = 0;
  const all = (table: string, where?: string) => w.rows(`SELECT * FROM ${table}${where === undefined ? '' : ` WHERE ${where}`} ORDER BY id`);
  const one = async (table: string, id: unknown) => (await all(table, `id = ${String(id)}`))[0]!;
  const ticket = async (lines: Doc[]): Promise<number> => Number((await w.tree({ table: 'till_tickets', values: {}, lists: { lines: { table: 'till_ticket_lines', via: 'ticket_id', rows: lines } } })).root['id']);
  const card = async (amount: string) => {
    const root = (await w.tree({ table: 'offers_gift_cards', values: {}, lists: { actions: { table: 'offers_card_actions', via: 'card_id', rows: [{ action: 'issue', amount, reason: 'Sold at the desk', paid_by: 'cash' }] } } })).root;
    return { id: Number(root['id']), code: String((await one('offers_gift_cards', root['id']))['code']) };
  };

  beforeAll(async () => {
    if (!run) return;
    w = saveWorld(await priceWorld(dialect, { market: till(), app: 'till', noThings: true, kit: offers!.manifest, addOn: { key: 'offers', files: offers!.files, server: offers!.files['dist/server.js']! } }));
    mug = await w.insert('till_items', { name: 'Mug, speckled' });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.close();
  });

  it.skipIf(!run)('a typed code comes off the ticket, and is counted when the ticket is paid and given back when it is voided', async () => {
    const tenth = await w.create('offers_offers', { name: 'Tenth', public_name: { 'en-US': 'Ten percent off' }, gives: 'percent', value: '10', applies_to: 'order', trigger: 'code' });
    await w.update('offers_offers', tenth['id'], { status: 'active' });
    await w.create('offers_codes', { offer_id: tenth['id'], code: 'TENTH', active: true });
    const id = await ticket([{ item_id: mug, unit_price: '40.00', qty: 2 }]);
    await w.create('till_ticket_codes', { ticket_id: id, typed: 'tenth' });
    const priced = await one('till_tickets', id);
    expect([money2(priced['subtotal']), money2(priced['discount']), money2(priced['net'])]).toEqual(['80.00', '8.00', '72.00']);
    expect(await all('offers_redemptions')).toEqual([]);
    await w.update('till_tickets', id, { status: 'paid' });
    expect((await all('offers_redemptions')).map((row) => `${String(row['kind'])} ${money2(row['amount'])} ${String(row['state'])}`)).toEqual(['code 8.00 counted']);
    await w.update('till_tickets', id, { status: 'void' });
    expect((await all('offers_redemptions')).map((row) => String(row['state']))).toEqual(['given_back']);
  });

  it.skipIf(!run)('a line that loads a gift card puts its amount on the card when the ticket is paid', async () => {
    const blank = await w.create('offers_gift_cards', {});
    const id = await ticket([{ gift_card_id: blank['id'], load_amount: '25.00', unit_price: '25.00', qty: 1 }]);
    expect(money2((await one('offers_gift_cards', blank['id']))['balance'])).toBe('0.00');
    await w.update('till_tickets', id, { status: 'paid' });
    const loaded = await one('offers_gift_cards', blank['id']);
    expect([String(loaded['status']), money2(loaded['balance'])]).toEqual(['active', '25.00']);
  });

  it.skipIf(!run)('a gift card pays a payment the tool\'s rule hands it, and a voided payment gives it back', async () => {
    const held = await card('30.00');
    const id = await ticket([{ item_id: mug, unit_price: '12.00', qty: 1 }]);
    await w.update('till_tickets', id, { due: '12.00' });
    const paid = await w.create('till_payments', { ticket_id: id, card_code: held.code });
    const row = await one('till_payments', paid['id']);
    expect([money2(row['amount']), money2(row['card_balance_after'])]).toEqual(['12.00', '18.00']);
    expect(money2((await one('offers_gift_cards', held.id))['balance'])).toBe('18.00');
    await w.update('till_payments', paid['id'], { voided_at: new Date().toISOString() });
    expect(money2((await one('offers_gift_cards', held.id))['balance'])).toBe('30.00');
  });
});
