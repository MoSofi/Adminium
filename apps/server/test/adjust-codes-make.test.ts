// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DISCOUNT CODE, BEFORE IT IS SAVED — and the one start no code may have.
 *
 * Asked for a code, the add-on's owner gets one no stored code has or reads
 * like. With a word of their own they are told how it will be kept, whether
 * it is taken, and which stored codes a customer could mix it up with. A word
 * that starts as a voucher's or a card's code does is refused there — and at
 * the save, whichever door it comes through, which is the authority.
 */
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lookAlikeFold, reservedIssue, reservedStart } from '../src/crud/code-lookup.js';
import { generateCode, lastFourOf, lastFours, madeCode, regenerateCodes } from '../src/crud/decided-columns.js';
import { priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { refused, saveWorld } from './adjust-save.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { PRICE_KIT } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
type Made = { code: string; taken?: boolean; lookAlikes?: { code: string; name: string }[] };

describe.each(LEGS)('a discount code, before it is saved — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let offers: Record<string, number>;
  const cookies = new Map<string, string>();
  const tableId = (name: string) => w.table(name).id;
  const make = (body: Doc, as = 'boss', key = PRICE_KIT) =>
    served.composed.app.inject({ method: 'POST', url: `/api/v1/add-ons/${key}/codes/make`, headers: as === '' ? {} : { cookie: cookies.get(as)! }, payload: body as never });
  const made = async (body: Doc, as = 'boss'): Promise<Made> => {
    const res = await make(body, as);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Made;
  };
  const staff = (method: string, url: string, payload: Doc) =>
    served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${w.h.connectionId}/${url}`, headers: { cookie: cookies.get('boss')! }, payload: payload as never });

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>): Promise<void> {
    const user = await usersRepo(w.h.meta).create({ email: `${name}@market.example`, name, passwordHash: await adminPasswordHash(), status: 'active' });
    const roles = rolesRepo(w.h.meta);
    if (grants === 'super-admin') await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const [table, actions] of Object.entries(grants)) {
        await permissionsRepo(w.h.meta).grant(role.id, 'table', `${w.h.connectionId}/${tableId(table)}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.3.0.${String(cookies.size + 1)}`, payload: { email: `${name}@market.example`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
  }

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect);
    ({ offers } = await seedOffers(w, { timeless: true }));
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    await person('boss', 'super-admin');
    // Makes codes, and does not read the offers they belong to.
    await person('clerk', { price_kit_codes: { read: true, create: true } });
    await person('reader', { price_kit_codes: { read: true }, price_kit_offers: { read: true } });
    await person('eager', { price_kit_codes: { read: true, create: true } });
    // Makes codes and reads none.
    await person('maker', { price_kit_codes: { create: true } });
  }, 240_000);
  afterAll(async () => {
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('a made code is free and reads like no other; a look-alike warns', async () => {
    const stored = new Set((await w.rows('SELECT code FROM price_kit_codes')).map((row) => String(row['code'])));
    const seen = new Set<string>();
    for (let n = 0; n < 5; n += 1) {
      const one = await made({});
      expect(one.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(one.code).not.toMatch(/^(GC|VC|PK)/);
      expect(stored.has(one.code)).toBe(false);
      expect(one).toEqual({ code: one.code });
      seen.add(one.code);
    }
    expect(seen.size).toBe(5);
    // A word of the owner's own: kept as codes are kept, free — and one letter from a code customers already have.
    expect(await made({ word: 'autumn-s' })).toEqual({ code: 'AUTUMNS', taken: false, lookAlikes: [{ code: 'AUTUMN5', name: 'Autumn 5' }] });
    // The word of a stored code is taken, and is no look-alike of itself.
    expect(await made({ word: ' Autumn 5 ' })).toEqual({ code: 'AUTUMN5', taken: true, lookAlikes: [] });
    expect(await made({ word: 'SPRING25' })).toEqual({ code: 'SPRING25', taken: false, lookAlikes: [] });
    // O for 0, I and L for 1, B for 8, Z for 2, G for 6 — whatever case the stored code is in.
    await w.rows(`INSERT INTO price_kit_codes (code, offer_id) VALUES ('be1o26z', ${String(offers['Welcome 10'])})`);
    expect(await made({ word: '8ELO2G2' })).toMatchObject({ code: '8ELO2G2', taken: false, lookAlikes: [{ code: 'BE1O26Z', name: 'Welcome 10' }] });
    expect(await made({ word: 'BE1O26Z' })).toMatchObject({ taken: true, lookAlikes: [] });
    await w.rows(`INSERT INTO price_kit_codes (code, offer_id) VALUES ('GOLDS', ${String(offers['Tote pair'])})`);
    expect((await made({ word: '60LD5' })).lookAlikes).toEqual([{ code: 'GOLDS', name: 'Tote pair' }]);
    // A word with more look-alikes than are told is no less taken for them; and the five told are never the word itself.
    for (const twin of ['5A1E5', '5ALE5', '5AIE5', 'SA1E5', 'SALE5', 'SAIE5', 'SA1ES']) await w.rows(`INSERT INTO price_kit_codes (code, offer_id) VALUES ('${twin}', ${String(offers['Tote pair'])})`);
    const crowded = await made({ word: 'sale5' });
    expect(crowded.taken).toBe(true);
    expect(crowded.lookAlikes).toHaveLength(5);
    expect(crowded.lookAlikes!.map((one) => one.code)).not.toContain('SALE5');
    await w.rows(`DELETE FROM price_kit_codes WHERE offer_id = ${String(offers['Tote pair'])} AND code <> 'GOLDS'`);
    // Nothing was stored by asking.
    expect((await w.rows('SELECT code FROM price_kit_codes')).length).toBe(stored.size + 2);
  });

  it.skipIf(!available)('only discount codes are compared: a voucher that reads like the word is never told', async () => {
    await w.rows(`INSERT INTO price_kit_vouchers (code, worth, value) VALUES ('FLASH5FLASH5', 'amount', 5)`);
    expect(await made({ word: 'FLASHSFLASHS' })).toEqual({ code: 'FLASHSFLASHS', taken: false, lookAlikes: [] });
  });

  it.skipIf(!available)('a word that is no code, or starts as a voucher\'s or a card\'s does, is refused', async () => {
    for (const word of ['GC-HELLO', 'vc hello', 'PK1', 'gc']) {
      const res = await make({ word });
      expect(res.statusCode, `${word}: ${res.body}`).toBe(422);
      expect((res.json() as { error: { details: { fields: Doc } } }).error.details.fields).toEqual({ word: { code: 'reserved' } });
    }
    for (const word of ['héllo wörld', '***', 'A'.repeat(33)]) {
      const res = await make({ word });
      expect(res.statusCode, `${word}: ${res.body}`).toBe(422);
      expect((res.json() as { error: { details: { fields: Doc } } }).error.details.fields).toEqual({ word: { code: 'invalid' } });
    }
    expect((await make({ word: '' })).statusCode).toBe(422);
    expect((await make({ word: 'X'.repeat(65) })).statusCode).toBe(422);
    expect((await make({ code: 'SPRING' })).statusCode).toBe(422);
    // A word that only holds a reserved word further in is a word like any other.
    expect((await made({ word: 'BIGCUP' })).taken).toBe(false);
  });

  it.skipIf(!available)('for somebody who may make codes; what a look-alike belongs to is named to somebody who reads that', async () => {
    expect((await make({ word: 'AUTUMNS' }, '')).statusCode).toBe(401);
    const reader = await make({ word: 'AUTUMNS' }, 'reader');
    expect(reader.statusCode, reader.body).toBe(403);
    expect(reader.body).not.toContain('AUTUMN5');
    // Makes codes, and does not read offers: the look-alike is told, and not the offer it is a code of.
    expect(await made({ word: 'AUTUMNS' }, 'clerk')).toEqual({ code: 'AUTUMNS', taken: false, lookAlikes: [{ code: 'AUTUMN5', name: '' }] });
    // Makes codes and reads none: told whether the word is free, never which stored codes read like it.
    expect(await made({ word: 'AUTUMNS' }, 'maker')).toEqual({ code: 'AUTUMNS', taken: false, lookAlikes: [] });
    expect(await made({ word: 'AUTUMN5' }, 'maker')).toEqual({ code: 'AUTUMN5', taken: true, lookAlikes: [] });
    expect((await make({}, 'boss', 'no-such')).statusCode).toBe(404);
    await w.h.meta.db.updateTable('adminium_manifests').set({ status: 'disabled' } as never).where('manifestKey', '=', PRICE_KIT).execute();
    const off = await make({});
    await w.h.meta.db.updateTable('adminium_manifests').set({ status: 'installed' } as never).where('manifestKey', '=', PRICE_KIT).execute();
    expect(off.statusCode, off.body).toBe(409);
    expect((off.json() as { error: { code: string } }).error.code).toBe('FEATURE_OFF');
  });

  it.skipIf(!available)('the save is the authority: a discount code with a reserved start is refused through every door, and any other is kept', async () => {
    const codes = encodeURIComponent(tableId('price_kit_codes'));
    const offer = offers['Tote pair'];
    for (const code of ['GC-HELLO', 'vc hello', 'pk1']) {
      const res = await staff('POST', codes, { values: { code, offer_id: offer } });
      expect(res.statusCode, `${code}: ${res.body}`).toBe(422);
      expect((res.json() as { error: { details: { fields: Doc } } }).error.details.fields).toEqual({ code: { code: 'reserved' } });
    }
    const kept = await staff('POST', codes, { values: { code: 'big-cup', offer_id: offer } });
    expect(kept.statusCode, kept.body).toBe(201);
    const id = (kept.json() as { data: Doc }).data['id'];
    expect((kept.json() as { data: Doc }).data['code']).toBe('BIGCUP');
    // A change of a stored code.
    const changed = await staff('PATCH', `${codes}/${String(id)}`, { values: { code: 'Vc-Cup' } });
    expect(changed.statusCode, changed.body).toBe(422);
    expect((changed.json() as { error: { details: { fields: Doc } } }).error.details.fields).toEqual({ code: { code: 'reserved' } });
    // A change that leaves the code alone is not judged by it.
    expect((await staff('PATCH', `${codes}/${String(id)}`, { values: { max_uses: 5 } })).statusCode).toBe(200);
    // Many at once, and an import: the same rule, each row's own issue.
    const bulk = await staff('POST', `${codes}/bulk`, { action: 'update', ids: [id], values: { code: 'GCUP' } });
    expect(JSON.stringify(bulk.json())).toContain('reserved');
    const save = saveWorld(w);
    // Rows checked many at a time, before any is written: each such row's own issue.
    const checked = await save.writes.check('create', w.target('price_kit_codes'), { origin: 'import', hops: 0, actor: null, request: null }, [{ code: 'gc-many', offer_id: offer }, { code: 'many', offer_id: offer }]);
    expect(checked.issues).toEqual([{ code: { code: 'reserved' } }, null]);
    const imported = await refused(save.create('price_kit_codes', { code: 'PK-IMPORTED', offer_id: offer }, { origin: 'import', hops: 0, actor: null, request: null }));
    expect(imported).toMatchObject({ statusCode: 422, details: { fields: { code: { code: 'reserved' } } } });
    expect((await w.rows(`SELECT code FROM price_kit_codes WHERE id = ${String(id)}`))[0]!['code']).toBe('BIGCUP');
    // The same word in a table that keeps no discount codes is nobody's business: a voucher's own code may start so.
    const voucher = await save.create('price_kit_vouchers', { code: 'GC9QXA41TR7K', worth: 'amount', value: '5.00' }, { origin: 'import', hops: 0, actor: null, request: null });
    expect(voucher['code']).toBe('GC9QXA41TR7K');
  });

  it.skipIf(!available || dialect !== 'sqlite')('the 31st in a minute is refused, per person', async () => {
    for (let n = 0; n < 30; n += 1) expect((await make({ word: 'SPRING25' }, 'eager')).statusCode, String(n)).toBe(200);
    const over = await make({ word: 'SPRING25' }, 'eager');
    expect(over.statusCode, over.body).toBe(429);
    expect((over.json() as { error: { details?: { bucket?: string } } }).error.details?.bucket).toBe('codes-make');
    expect((await make({ word: 'SPRING25' }, 'clerk')).statusCode).toBe(200);
  });
});

describe('how a code reads', () => {
  it('two codes that fold alike are easy to mix up', () => {
    expect(lookAlikeFold('AUTUMNS')).toBe(lookAlikeFold('AUTUMN5'));
    expect(lookAlikeFold('B0ZG')).toBe('8026');
    expect(lookAlikeFold('OIL')).toBe('011');
    expect(lookAlikeFold('SUMMER10')).not.toBe(lookAlikeFold('SUMMER20'));
  });

  it('a reserved start is judged on the code as codes are kept', () => {
    const words = ['GC', 'VC', 'PK'];
    expect(reservedStart('GCHELLO', words)).toBe('GC');
    expect(reservedStart('BIGCUP', words)).toBeNull();
    expect(reservedStart('G', words)).toBeNull();
    expect(reservedStart('GCHELLO', [])).toBeNull();
    const rules = { reservedStarts: { column: 'code', words } };
    expect(reservedIssue(rules, { code: 'gc-hello' })).toEqual({ code: { code: 'reserved' } });
    expect(reservedIssue(rules, { code: 'hello' })).toBeNull();
    expect(reservedIssue(rules, { other: 'GC' })).toBeNull();
    expect(reservedIssue(rules, { code: null })).toBeNull();
    expect(reservedIssue({}, { code: 'GC' })).toBeNull();
    expect(reservedIssue(null, { code: 'GC' })).toBeNull();
  });

  it('the last four of a code follow the code, and nothing else', () => {
    expect(lastFourOf('GC-7K2M-W3HN-q4xp')).toBe('Q4XP');
    expect(lastFourOf('ab')).toBe('AB');
    expect(lastFourOf('--')).toBeNull();
    expect(lastFourOf(null)).toBeNull();
    expect(lastFourOf(1234)).toBeNull();
    const rules = { lastFours: [{ column: 'last4', of: 'code' }] };
    // A new row: cut from its code, whatever a writer sent; none for a row with no code.
    expect(lastFours(rules, 'create', { code: 'GC-7K2MW3HNQ4XP', last4: 'ZZZZ' })).toEqual({ code: 'GC-7K2MW3HNQ4XP', last4: 'Q4XP' });
    expect(lastFours(rules, 'create', { label: 'x' })).toEqual({ label: 'x', last4: null });
    // A change that writes the code cuts them again; one that leaves it alone leaves them alone.
    expect(lastFours(rules, 'update', { code: 'GC-AAAABBBBCCCC' })).toEqual({ code: 'GC-AAAABBBBCCCC', last4: 'CCCC' });
    const untouched = { label: 'renamed' };
    expect(lastFours(rules, 'update', untouched)).toBe(untouched);
    expect(lastFours(rules, 'delete', untouched)).toBe(untouched);
    expect(lastFours(null, 'create', untouched)).toBe(untouched);
    expect(lastFours({}, 'create', untouched)).toBe(untouched);
  });

  it('every code made brings its last four with it, however it comes to be made again', () => {
    const rule = { column: 'code', prefix: 'GC-', length: 12, last4: ['last4'] };
    const made = madeCode(rule);
    expect(made['code']).toMatch(/^GC-[0-9A-Z]{12}$/);
    expect(made['last4']).toBe(String(made['code']).slice(-4));
    expect(Object.keys(madeCode({ column: 'code', prefix: '', length: 8 }))).toEqual(['code']);
    // A code that collided with a stored one and is made again leaves nothing of the first behind.
    const again = regenerateCodes({ code: 'GC-AAAAAAAAAAAA', last4: 'AAAA', label: 'kept' }, [rule]);
    expect(again['label']).toBe('kept');
    expect(again['code']).not.toBe('GC-AAAAAAAAAAAA');
    expect(again['last4']).toBe(String(again['code']).slice(-4));
  });

  it('a made code never starts with a word it is to avoid', () => {
    // Half of all starts are to be avoided: none of two hundred made codes has one.
    const avoid = [...'0123456789ABCDEF'];
    for (let n = 0; n < 200; n += 1) expect(avoid).not.toContain(generateCode('', 6, avoid).charAt(0));
    expect(generateCode('GC-', 4)).toMatch(/^GC-[0-9A-Z]{4}$/);
  });
});
