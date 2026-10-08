// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO MAY DO WHAT WITH A CARD.
 *
 * Offers ships three roles. A manager does everything. The desk looks a card
 * up, issues a voucher, records a voucher's use and sends a card again — and
 * moves no money: no top-up, no correction, no cancel, no card by hand. A
 * viewer changes nothing. Neither the desk nor the viewer ever reads a whole
 * card or voucher code: not on a list, not on a record, not by asking for the
 * column by name, not through a look-up. Asked through the data routes,
 * signed in — the way the dashboard and the add-on's own screens ask.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from '../../auth-helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { servePublic, type Served } from '../../public-lane.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
type Doc = Record<string, unknown>;
interface Kit {
  connectionId: string;
  tables: Record<string, { id: string; can: Record<string, boolean>; unreadable: string[]; states?: { actions?: { id: string; from: string[] }[] } }>;
  has: Record<string, boolean>;
}

async function signIn(served: Served, meta: Writing['h']['meta'], name: string, cookies: Map<string, string>): Promise<string> {
  const user = await usersRepo(meta).create({ email: `${name}@offers.dev`, name, passwordHash: await adminPasswordHash() });
  const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.4.0.${String(cookies.size + 1)}`, payload: { email: `${name}@offers.dev`, password: ADMIN_PASSWORD } });
  cookies.set(name, sessionCookie(login.headers['set-cookie']));
  return user.id;
}

describe.each(LEGS)("Offers' three roles — %s", (dialect, available) => {
  const run = available && offers !== null;
  let w: Writing;
  let served: Served;
  let card: Doc;
  let voucher: Doc;
  const cookies = new Map<string, string>();
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const as = (who: string, method: string, url: string, payload?: unknown) => served.composed.app.inject({ method: method as 'GET', url, headers: { cookie: cookies.get(who)! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const kit = async (who: string) => (await as(who, 'GET', '/api/v1/add-ons/offers/kit')).json() as Kit;
  const data = (at: Kit, ref: string) => `/api/v1/data/${at.connectionId}/${encodeURIComponent(at.tables[ref]!.id)}`;
  const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;

  beforeAll(async () => {
    installCustomerKey('a secret only this test server knows, long enough');
    if (!run) return;
    w = await writing(await installBuilt(dialect, offers));
    // A card with fifty on it and a pack of ten, made by somebody who holds every role.
    const made = (await w.create('gift_cards', { recipient_name: 'Ana', recipient_email: 'ana@calla.dev' })).row;
    await w.create('card_actions', { card_id: made['id'], action: 'issue', amount: '50.00', reason: 'Sold at the desk', paid_by: 'cash' });
    card = await w.one('gift_cards', made['id']);
    voucher = await w.one('vouchers', (await w.create('vouchers', { worth: 'pack', what: 'tag', source_row: 'classes', public_name: '10 classes', uses_total: 10 })).row['id']);
    // The composed server loads the add-on's own built file, as an install trusted on this machine.
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'offers';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const roles = rolesRepo(w.h.meta);
    for (const [name, slug] of [['max', 'offers-manager'], ['dee', 'offers-desk'], ['vera', 'offers-viewer']] as const) {
      const id = await signIn(served, w.h.meta, name, cookies);
      await roles.assignToUser(id, (await roles.findBySlug(slug))!.id);
    }
  }, 600_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!run) return;
    await served?.close();
    await w.h.close();
  });

  it.skipIf(!run)('each role is shown the pages that are its own, and is served no other screen\'s code', async () => {
    // Without a page a role holds every right on its tables and sees nothing: nobody but a Super Admin could open Offers.
    const shown = async (who: string) => {
      const start = (await as(who, 'GET', '/api/v1/bootstrap')).json() as { data: { addOnNav: { pages: { ref: string }[] } } };
      // The generated pages, wherever the rail keeps them: named by their own address.
      const listed = JSON.stringify({ ...start.data, addOnNav: undefined });
      return {
        code: start.data.addOnNav.pages.map((page) => page.ref.replace(/^offers-/, '')).sort(),
        lists: ['overview', 'codes', 'vouchers', 'voucher-batches', 'gift-cards', 'activity', 'uses', 'groups', 'reasons', 'staff-limits', 'messages', 'settings'].filter((ref) => listed.includes(`offers-${ref}"`)),
      };
    };
    expect(await shown('max')).toEqual({ code: ['discounts', 'issue', 'look-up', 'rules'], lists: ['overview', 'codes', 'vouchers', 'voucher-batches', 'gift-cards', 'activity', 'uses', 'groups', 'reasons', 'staff-limits', 'messages', 'settings'] });
    expect(await shown('dee')).toEqual({ code: ['issue', 'look-up'], lists: ['overview', 'vouchers', 'gift-cards', 'activity', 'uses'] });
    expect(await shown('vera')).toEqual({ code: ['discounts', 'look-up'], lists: ['overview', 'codes', 'vouchers', 'voucher-batches', 'gift-cards', 'activity', 'uses'] });
    // The gate hides a screen and the route is the boundary: the desk is not handed the rules screen's code.
    const kitOf = await kit('dee');
    expect(kitOf.has['page:offers-look-up:view']).toBe(true);
    expect(kitOf.has['page:offers-rules:view']).toBe(false);
    expect(kitOf.has['page:offers-discounts:view']).toBe(false);
  });

  it.skipIf(!run)('the desk and the viewer never read a whole card or voucher code', async () => {
    const [cardCode, voucherCode] = [String(card['code']), String(voucher['code'])];
    expect(cardCode).toMatch(/^GC-[0-9A-Z]{12}$/);
    expect(voucherCode).toMatch(/^[0-9A-Z]{12}$/);
    for (const who of ['dee', 'vera']) {
      const at = await kit(who);
      expect(at.tables['gift_cards']!.unreadable, who).toContain('code');
      expect(at.tables['vouchers']!.unreadable, who).toContain('code');
      // A list, a record, and the column asked for by name.
      const bodies = [await as(who, 'GET', data(at, 'gift_cards')), await as(who, 'GET', `${data(at, 'gift_cards')}/${String(card['id'])}`), await as(who, 'GET', data(at, 'vouchers')), await as(who, 'GET', `${data(at, 'vouchers')}/${String(voucher['id'])}`), await as(who, 'GET', `${data(at, 'gift_cards')}?select=id,code`), await as(who, 'GET', `${data(at, 'vouchers')}?select=id,code`)];
      for (const res of bodies) {
        expect(res.body, who).not.toContain(cardCode);
        expect(res.body, who).not.toContain(cardCode.slice(3));
        expect(res.body, who).not.toContain(voucherCode);
      }
      // Its last four are theirs to read: that is how a card is named to them.
      expect((await as(who, 'GET', `${data(at, 'gift_cards')}/${String(card['id'])}`)).body, who).toContain(cardCode.slice(-4));
    }
    // The manager reads it.
    const max = await kit('max');
    expect((await as('max', 'GET', `${data(max, 'gift_cards')}/${String(card['id'])}`)).body).toContain(cardCode);
  });

  it.skipIf(!run)('a role that cannot read a card\'s code draws no card with it', async () => {
    const code = String(card['code']).slice(3);
    const fours = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    const draw = async (who: string): Promise<{ status: number; body: string }> => {
      const res = await as(who, 'POST', '/api/v1/add-ons/offers/documents/render', { kind: 'gift-card', table: 'gift_cards', key: card['id'] });
      if (res.statusCode !== 200) return { status: res.statusCode, body: res.body };
      const opened = await as(who, 'GET', (res.json() as { printUrl: string }).printUrl);
      return { status: opened.statusCode, body: opened.body };
    };
    // Asked by the desk or the viewer, no page carries it. (This server draws no document at all — `print.test.ts`
    // draws them — so what is proved here is only that neither is handed the code by asking.)
    for (const who of ['dee', 'vera']) {
      const drawn = await draw(who);
      expect(drawn.body, who).not.toContain(fours);
      expect(drawn.body, who).not.toContain(code);
    }
  });

  it.skipIf(!run)('a look-up answers the desk what a card is and what is on it, and carries no code back for anybody', async () => {
    for (const who of ['max', 'dee']) {
      const res = await as(who, 'POST', '/api/v1/add-ons/offers/look-up', { value: String(card['code']) });
      expect(res.statusCode, res.body).toBe(200);
      const reply = res.json() as { found: boolean; kind: string; last4: string; record: Doc };
      expect(reply).toMatchObject({ found: true, kind: 'gift-card', last4: String(card['code']).slice(-4) });
      expect(Number(reply.record['balance'])).toBe(50);
      expect(res.body, who).not.toContain(String(card['code']).slice(3));
      // The desk is not told the address a card goes to.
      if (who === 'dee') expect(res.body).not.toContain('ana@calla.dev');
    }
  });

  it.skipIf(!run)('the desk cannot top up, adjust, cancel or issue a card by hand; the manager can', async () => {
    const at = await kit('dee');
    expect(at.tables['card_actions']?.can['create'] ?? false).toBe(false);
    const topUp = await as('dee', 'POST', `/api/v1/data/${at.connectionId}/${encodeURIComponent(w.real('card_actions'))}`, { values: { card_id: card['id'], action: 'top_up', amount: '25.00', reason: 'x', paid_by: 'cash' } });
    expect(topUp.statusCode, topUp.body).not.toBe(201);
    expect(topUp.statusCode).toBeGreaterThanOrEqual(400);
    // A card for a sale may be made at the desk — it holds nothing and is inactive until its order is paid — but the
    // desk cannot put value on it by hand, which is what issuing one is.
    const made = await as('dee', 'POST', data(at, 'gift_cards'), { values: { recipient_name: 'Ben' } });
    expect(made.statusCode, made.body).toBe(201);
    const blank = (made.json() as { data: Doc }).data;
    expect(blank['status']).toBe('inactive');
    const load = await as('dee', 'POST', `/api/v1/data/${at.connectionId}/${encodeURIComponent(w.real('card_actions'))}`, { values: { card_id: blank['id'], action: 'issue', amount: '50.00', reason: 'x', paid_by: 'cash' } });
    expect(load.statusCode, load.body).toBeGreaterThanOrEqual(400);
    expect((await w.one('gift_cards', blank['id']))['status']).toBe('inactive');
    const cancel = await as('dee', 'POST', `${data(at, 'gift_cards')}/${String(card['id'])}/actions/cancel-card`, { values: { void_reason: 'x' } });
    expect(cancel.statusCode, cancel.body).toBeGreaterThanOrEqual(400);
    // Nothing moved.
    expect(Number((await w.one('gift_cards', card['id']))['balance'])).toBe(50);
    expect((await w.one('gift_cards', card['id']))['status']).toBe('active');
    // The same top-up by the manager goes through.
    const max = await kit('max');
    const done = await as('max', 'POST', data(max, 'card_actions'), { values: { card_id: card['id'], action: 'top_up', amount: '25.00', reason: 'Asked for more', paid_by: 'cash' } });
    expect(done.statusCode, done.body).toBe(201);
    expect(Number((await w.one('gift_cards', card['id']))['balance'])).toBe(75);
  });

  it.skipIf(!run)('the desk issues a voucher and is handed its code once; it marks a voucher as used; a viewer does neither', async () => {
    const at = await kit('dee');
    const issued = await as('dee', 'POST', data(at, 'vouchers'), { values: { worth: 'amount', value: '5', public_name: 'Five off' } });
    expect(issued.statusCode, issued.body).toBe(201);
    const reply = issued.json() as { data: Doc; once?: { column: string; value: string; print: string }[] };
    // The row as the desk reads it carries no code; the code comes beside it, once, with a token that prints it.
    expect(reply.data['code']).toBeUndefined();
    expect(reply.once?.map((one) => one.column)).toEqual(['code']);
    expect(reply.once?.[0]?.value).toMatch(/^[0-9A-Z]{12}$/);
    expect(reply.once?.[0]?.print.length).toBeGreaterThan(20);
    const used = await as('dee', 'POST', data(at, 'voucher_actions'), { values: { voucher_id: voucher['id'], action: 'use' } });
    expect(used.statusCode, used.body).toBe(201);
    expect(Number((await w.one('vouchers', voucher['id']))['uses_left'])).toBe(9);
    const vera = await kit('vera');
    for (const [ref, values] of [['vouchers', { worth: 'amount', value: '5', public_name: 'Five off' }], ['voucher_actions', { voucher_id: voucher['id'], action: 'use' }]] as const) {
      const res = await as('vera', 'POST', `/api/v1/data/${vera.connectionId}/${encodeURIComponent(w.real(ref))}`, { values });
      expect(res.statusCode, `${ref}: ${res.body}`).toBeGreaterThanOrEqual(400);
    }
    expect(Number((await w.one('vouchers', voucher['id']))['uses_left'])).toBe(9);
  });

  it.skipIf(!run)('the desk cannot store, switch or remove a rule, and the kit tells no role it may', async () => {
    for (const who of ['max', 'dee', 'vera']) expect((await kit(who)).has['system:schema:remap'], who).toBe(false);
    const at = await kit('dee');
    const store = await as('dee', 'PUT', `/api/v1/connections/${at.connectionId}/tables/${encodeURIComponent(w.real('gift_cards'))}/postings/offers-card`, { into: { addOn: 'offers', ledger: 'value', action: 'spend' }, post: { on: { create: true } }, map: {} });
    expect(store.statusCode, store.body).toBe(403);
    const adjust = await as('dee', 'PUT', `/api/v1/connections/${at.connectionId}/tables/${encodeURIComponent(w.real('gift_cards'))}/adjust`, { adjust: {} });
    expect([400, 403, 422]).toContain(adjust.statusCode);
    expect(errorOf(adjust)).not.toBeUndefined();
  });

  it.skipIf(!run)('a batch and its file are the manager\'s: the desk makes none and reads no code to export', async () => {
    const at = await kit('dee');
    expect(at.tables['voucher_batches']?.can['create'] ?? false).toBe(false);
    const batch = await as('dee', 'POST', `/api/v1/data/${at.connectionId}/${encodeURIComponent(w.real('voucher_batches'))}`, { values: { name: 'Leaflets', count: 5, worth: 'amount', value: '5', public_name: 'Five off', expires_on: '2099-12-31' } });
    expect(batch.statusCode, batch.body).toBeGreaterThanOrEqual(400);
    const file = await as('dee', 'POST', '/api/v1/exports', { connectionId: at.connectionId, source: { kind: 'table', table: at.tables['vouchers']!.id, columns: [{ name: 'code', label: 'code' }] }, format: 'csv' });
    expect(file.statusCode, file.body).toBeGreaterThanOrEqual(400);
  });
});
