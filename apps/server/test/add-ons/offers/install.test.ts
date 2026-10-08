// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS & GIFT CARDS, INSTALLED.
 *
 * The add-on as it is built in the add-ons repository, installed with no app
 * on each database: its twenty tables under its own name, the one settings
 * row an install makes, its three roles — and the first rows a person makes
 * in them, with the codes Adminium makes and the ones it refuses.
 */
import { rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
const refusal = async (run: Promise<unknown>): Promise<{ code?: string; details?: Record<string, unknown> } & Error> => {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown> } & Error;
  }
  throw new Error('the save went through');
};

describe.skipIf(offers === null)('Offers, as it is built', () => {
  it('names one file that decides, for both questions, and it is built', () => {
    expect(Object.keys(offers?.files ?? {}).sort()).toEqual(['dist/documents.js', 'dist/pages/discounts.js', 'dist/pages/issue.js', 'dist/pages/look-up.js', 'dist/pages/rules.js', 'dist/server.js', 'seeds/offers.sample.json']);
    const provides = (offers?.manifest['addOn'] as { provides: { contract: string }[] }).provides;
    // The file that decides answers both questions; what Offers prints is a module of its own.
    expect(provides.map((one) => one.contract)).toEqual(['posting-rows', 'price-adjust', 'document-render']);
  });
});

describe.each(LEGS)('Offers installed with no app — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: Writing;
  beforeAll(async () => {
    // The server says its secret as it starts; a key that stands for an address is made under it.
    installCustomerKey('a secret only this test server knows, long enough');
    if (run) w = await writing(await installBuilt(dialect, offers));
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('makes twenty tables under its own name, and says nothing was left out', async () => {
    const tables = (offers?.manifest['requiredSchema'] as { tables: { ref: string }[] }).tables.map((table) => table.ref);
    expect(tables).toHaveLength(20);
    const made = await w.h.tableNames();
    for (const ref of tables) expect(made, ref).toContain(w.real(ref));
    expect((w.reply['rules'] as { skipped?: unknown[] } | undefined)?.skipped ?? []).toEqual([]);
  });

  it.skipIf(!run)('installs the overview and eleven generated lists with no warning, in two groups of the rail', async () => {
    const pages = w.reply['pages'] as { created: string[]; warnings: unknown[] };
    expect(pages.created).toEqual([
      'offers-overview',
      'offers-codes',
      'offers-vouchers',
      'offers-voucher-batches',
      'offers-gift-cards',
      'offers-activity',
      'offers-uses',
      'offers-groups',
      'offers-reasons',
      'offers-staff-limits',
      'offers-messages',
      'offers-settings',
    ]);
    // A page bound to no table, or a form naming a column that is not there, would be told here.
    expect(pages.warnings).toEqual([]);
    expect(JSON.stringify(w.reply)).not.toContain('PAGE_FORM_INVALID');
  });

  it.skipIf(!run)('starts with the one settings row, from its columns\' own defaults, and nothing else', async () => {
    const settings = await w.rowsOf('settings');
    expect(settings).toHaveLength(1);
    expect(Number(settings[0]?.['card_min'])).toBe(10);
    expect(Number(settings[0]?.['card_max'])).toBe(500);
    expect(Number(settings[0]?.['card_reminder_days'])).toBe(30);
    expect(settings[0]?.['card_expiry_months']).toBeNull();
    for (const flag of ['combine_default', 'tax_later', 'cards_paused']) expect([false, 0, '0'], flag).toContain(settings[0]?.[flag]);
    // No reason, no group and no staff limit to begin with: no limit row is a limit of nothing.
    for (const ref of ['reasons', 'groups', 'ceilings', 'offers', 'codes', 'vouchers', 'gift_cards']) expect(await w.rowsOf(ref), ref).toHaveLength(0);
  });

  it.skipIf(!run)('ships a manager, a desk and a viewer', async () => {
    const roles = rolesRepo(w.h.meta);
    for (const slug of ['offers-manager', 'offers-desk', 'offers-viewer']) expect(await roles.findBySlug(slug), slug).not.toBeNull();
  });

  it.skipIf(!run)('a new offer is a draft that combines as the settings say, with no budget and nothing used', async () => {
    const { row } = await w.create('offers', { name: 'Welcome 10', public_name: { 'en-US': 'Welcome: 10% off' }, gives: 'percent', value: '10', trigger: 'code', applies_to: 'order' });
    const stored = await w.one('offers', row['id']);
    expect(stored['status']).toBe('draft');
    expect([false, 0, '0']).toContain(stored['combinable']);
    expect([true, 1, '1']).toContain(stored['budget_open']);
    expect(Number(stored['uses'] ?? 0)).toBe(0);
    // A percent with no value is refused by name.
    const bare = await refusal(w.create('offers', { name: 'No value', public_name: { 'en-US': 'x' }, gives: 'percent', trigger: 'automatic', applies_to: 'order' }));
    expect(bare.code, bare.message).toBe('VALIDATION_FAILED');
    // A budget is asked for only once the offer says it has one.
    const budget = await refusal(w.create('offers', { name: 'Capped', public_name: { 'en-US': 'x' }, gives: 'amount', value: '5', trigger: 'automatic', applies_to: 'order', budget_open: false }));
    expect(budget.code, budget.message).toBe('VALIDATION_FAILED');
  });

  it.skipIf(!run)('a discount code is a word somebody types, kept as it is compared, and never starts as a card or a voucher does', async () => {
    const offer = (await w.rowsOf('offers'))[0]!['id'];
    const typed = await w.create('codes', { offer_id: offer, code: 'welcome-10' });
    expect((await w.one('codes', typed.row['id']))['code']).toBe('WELCOME10');
    const other = await w.create('codes', { offer_id: offer, code: 'Autumn 5' });
    expect((await w.one('codes', other.row['id']))['code']).toBe('AUTUMN5');
    // A code with no word is no code: one is made on request before the save, never silently in it.
    await refusal(w.create('codes', { offer_id: offer }));
    for (const word of ['GC-SPRING', 'vc summer', 'PK1']) {
      const refused = await refusal(w.create('codes', { offer_id: offer, code: word }));
      expect(refused.code, `${word}: ${refused.message}`).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(refused.details), word).toContain('reserved');
    }
    // The same word twice is one code.
    const twice = await refusal(w.create('codes', { offer_id: offer, code: 'WELCOME 10' }));
    expect(twice.code, twice.message).toBeDefined();
    expect(await w.rowsOf('codes')).toHaveLength(2);
  });

  it.skipIf(!run)('a card is made inactive and holding nothing, with a code, its last four and a link token of its own', async () => {
    const { row } = await w.create('gift_cards', { recipient_name: 'Ada', message: 'Happy birthday' });
    const card = await w.one('gift_cards', row['id']);
    expect(card['kind']).toBe('card');
    expect(card['status']).toBe('inactive');
    expect(String(card['code'])).toMatch(/^GC-[0-9A-Z]{12}$/);
    expect(card['label']).toBe(String(card['code']).slice(-4));
    expect(String(card['link_token'])).toMatch(/^[0-9A-Z]{16}$/);
    expect(Number(card['opening'])).toBe(0);
    expect(Number(card['balance'] ?? 0)).toBe(0);
    expect(card['notify']).toBeNull();
    // Store credit belongs to an address: without one it is refused.
    const credit = await refusal(w.create('gift_cards', { kind: 'credit' }));
    expect(credit.code, credit.message).toBe('VALIDATION_FAILED');
    const owned = await w.create('gift_cards', { kind: 'credit', owner_email: ' Ada@Shop.Example ' });
    const stored = await w.one('gift_cards', owned.row['id']);
    expect(stored['owner_email']).toBe('ada@shop.example');
    // The key that stands for the address is Adminium's: sixty-four characters, and never the address.
    expect(String(stored['owner_key'])).toMatch(/^[0-9a-f]{64}$/);
    // No person makes a card active: that is the first row of money on it.
    const activated = await refusal(w.update('gift_cards', row['id'], { status: 'active' }));
    expect(activated.code, activated.message).toBe('STATE_MOVE_REFUSED');
    // A link or an address in the message is refused: it is printed and mailed as written.
    const linked = await refusal(w.create('gift_cards', { message: 'see https://example.com' }));
    expect(linked.code, linked.message).toBe('VALIDATION_FAILED');
  });

  it.skipIf(!run)('a voucher is made with twelve characters and no word, its last four kept beside it', async () => {
    const { row } = await w.create('vouchers', { worth: 'amount', value: '5', public_name: '$5 off' });
    const voucher = await w.one('vouchers', row['id']);
    expect(String(voucher['code'])).toMatch(/^[0-9A-Z]{12}$/);
    expect(voucher['code_last4']).toBe(String(voucher['code']).slice(-4));
    expect(voucher['status']).toBe('issued');
    expect(Number(voucher['uses_total'])).toBe(1);
    expect(Number(voucher['units'])).toBe(1);
    expect(voucher['source_table']).toBe('');
    // A pack says what it is a pack of.
    const pack = await refusal(w.create('vouchers', { worth: 'pack', public_name: '10 classes', uses_total: 10 }));
    expect(pack.code, pack.message).toBe('VALIDATION_FAILED');
    // Nobody marks a voucher used by hand: a use is a row, written by the ledger.
    const used = await refusal(w.update('vouchers', row['id'], { status: 'used' }));
    expect(used.code, used.message).toBe('STATE_MOVE_REFUSED');
  });
});
