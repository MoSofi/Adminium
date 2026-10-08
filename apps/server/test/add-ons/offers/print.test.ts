// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT OFFERS PRINTS, THROUGH THE SERVER.
 *
 * A gift card or a voucher is drawn by the add-on's own built module, from
 * the row as Adminium reads it for whoever asks: the code in its groups, a QR
 * code of it, what is on the card. A first print shows the amount; a later
 * one the balance and the day. Because the page prints a code that is worth
 * money, it is handed over through an address good for one print and is kept
 * nowhere. A credit has no card to print.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from '../../app-add-ons.helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { ADD_ONS_REPO, builtAddOn } from '../harness.js';

const offers = builtAddOn('offers');
type Doc = Record<string, unknown>;

describe.each(LEGS)('what Offers prints — %s', (dialect, available) => {
  const run = available && offers !== null;
  let h: Harness;
  const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
  const ask = (body: Doc) => h.inject({ method: 'POST', url: '/add-ons/offers/documents/render', payload: body });
  /** Asks for a document and opens the one-print address it is handed. */
  const page = async (body: Doc): Promise<string> => {
    const res = await ask(body);
    expect(res.statusCode, res.body).toBe(200);
    const reply = res.json() as { printUrl: string; ephemeral: boolean };
    expect(reply.ephemeral).toBe(true);
    const opened = await h.inject({ method: 'GET', url: reply.printUrl.replace('/api/v1', '') });
    expect(opened.statusCode, opened.body).toBe(200);
    return opened.body;
  };
  const kept = async () => Number((await h.meta.db.selectFrom('adminium_documents').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())!.n);

  beforeAll(async () => {
    if (!run) return;
    // The module an install would load: the built file, as it is.
    const module = ((await import(pathToFileURL(join(ADD_ONS_REPO!, 'packages', 'offers', 'dist', 'documents.js')).href)) as { default: unknown }).default;
    h = await addOnHarness(dialect, { unbuiltWords: {}, documents: { runtime: () => state as never }, onRebuild: () => state.providers.set('document-render@1', [{ addOnKey: 'offers', contract: 'document-render', version: 1, module }]) });
    await h.stageAddOn(offers!.manifest, { bundled: true, files: offers!.files });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'offers', version: offers!.version, attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    const no = dialect === 'postgres' ? 'false' : '0';
    await h.rows(`INSERT INTO offers_gift_cards (id, kind, code, label, status, opening, balance, expires_on, moved_table, moving) VALUES (1, 'card', 'GC-7K2MW3HNQ4XP', 'Q4XP', 'active', 0, 50, '2027-08-03', '', ${no}), (2, 'credit', NULL, NULL, 'active', 0, 22, NULL, '', ${no})`);
    await h.rows(`UPDATE offers_gift_cards SET owner_email = 'ada@calla.dev' WHERE id = 2`);
    await h.rows(`INSERT INTO offers_vouchers (id, code, code_last4, worth, value, public_name, uses_total, uses_left, status, source_table, source_row, units, sold, awaiting_sale, tax_later) VALUES (5, 'AAAABBBB7K2M', '7K2M', 'pack', NULL, '10 classes', 10, 6, 'issued', '', '', 1, ${no}, ${no}, ${no}), (6, 'CCCCDDDD9ZZZ', '9ZZZ', 'amount', 5, 'Five off', 1, 1, 'issued', '', '', 1, ${no}, ${no}, ${no})`);
  }, 600_000);
  afterAll(async () => {
    if (run) await h.close();
  });

  it.skipIf(!run)('a gift card: its code in fours behind GC, a QR code, and the balance with the day it was printed', async () => {
    const before = await kept();
    const html = await page({ kind: 'gift-card', table: 'gift_cards', key: 1 });
    expect(html).toContain('<div class="code" dir="ltr">GC-7K2M-W3HN-Q4XP</div>');
    expect(html).toMatch(/<img class="qr" alt="" src="data:image\/png;base64,[A-Za-z0-9+/=]+">/);
    // A later print: what is on the card, and when that was true.
    expect(html).toMatch(/Balance [^<]*50\.00[^<]* on [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(html).toContain('Use it by Aug 3, 2027');
    // Nothing of it is kept: no document row, however often it is printed.
    await page({ kind: 'gift-card', table: 'gift_cards', key: 1 });
    expect(await kept()).toBe(before);
  });

  it.skipIf(!run)('a first print shows the amount, with no day; the strip is the same card on receipt paper', async () => {
    const first = await page({ kind: 'gift-card', table: 'gift_cards', key: 1, values: { first: '1' } });
    expect(first).toMatch(/<div class="figure"><span dir="ltr">[^<]*50\.00[^<]*<\/span><\/div>/);
    expect(first).not.toContain('Balance');
    const strip = await page({ kind: 'gift-card-strip', table: 'gift_cards', key: 1 });
    expect(strip).toContain('@page { size: 80mm auto;');
    expect(strip).toContain('GC-7K2M-W3HN-Q4XP');
    expect(first).toContain('@page { size: A6;');
  });

  it.skipIf(!run)('a pack says PK and what it has left; a voucher says VC and what it is worth', async () => {
    const pack = await page({ kind: 'voucher', table: 'vouchers', key: 5 });
    expect(pack).toContain('>PK-AAAA-BBBB-7K2M<');
    expect(pack).toContain('10 classes');
    expect(pack).toContain('6 of 10 uses left');
    const voucher = await page({ kind: 'voucher', table: 'vouchers', key: 6 });
    expect(voucher).toContain('>VC-CCCC-DDDD-9ZZZ<');
    expect(voucher).toMatch(/<div class="figure"><span dir="ltr">[^<]*5\.00[^<]*<\/span><\/div>/);
  });

  it.skipIf(!run)('a credit has no card to print, and a row that is not there answers the same', async () => {
    for (const body of [{ kind: 'gift-card', table: 'gift_cards', key: 2 }, { kind: 'gift-card', table: 'gift_cards', key: 99 }, { kind: 'voucher', table: 'gift_cards', key: 1 }]) {
      const res = await ask(body);
      // Refused when it is asked for, or — nothing being drawn until the address is opened — when it is opened: never a page.
      if (res.statusCode !== 200) continue;
      const opened = await h.inject({ method: 'GET', url: (res.json() as { printUrl: string }).printUrl.replace('/api/v1', '') });
      expect(opened.statusCode, `${JSON.stringify(body)}: ${opened.body.slice(0, 300)}`).not.toBe(200);
      expect(opened.body).not.toContain('<div class="code"');
    }
  });

  it.skipIf(!run)('an address prints once: opened again, it answers nothing', async () => {
    const res = await ask({ kind: 'gift-card', table: 'gift_cards', key: 1 });
    const url = (res.json() as { printUrl: string }).printUrl.replace('/api/v1', '');
    expect((await h.inject({ method: 'GET', url })).statusCode).toBe(200);
    expect((await h.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
});
