// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE TYPED VALUE, LOOKED UP ACROSS AN ADD-ON'S CODE TABLES.
 *
 * A card, a voucher, a pack and a discount word are each found by what was
 * typed or scanned, however it was spaced; a card also by its owner's
 * address. The answer is the found row as the caller's own role reads it —
 * and never the code, for anybody.
 */
import { overridesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { vaultKitManifest } from './fixtures/vault-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
type Found = { found: boolean; kind?: string; by?: string; table?: string; key?: string; last4?: string | null; record?: Doc; rows?: Doc[] | null; more?: number };

const CARD = 'GC-7K2MW3HNQ4XP';
const MOVED = 'GC-48219930';
const VOUCHER = '9QXA41TR7K2M';
const PACK = 'W3HNQ4XP9QXA';
const CODES = [CARD, MOVED, VOUCHER, PACK, 'GC7K2MW3HNQ4XP', 'SUMMER10', 'TWELVECHARS1'];

describe.each(LEGS)('an add-on\'s look-up — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  const cookies = new Map<string, string>();
  const tables = new Map<string, string>();
  const look = (value: unknown, as = 'boss', key = 'vault') =>
    served.composed.app.inject({ method: 'POST', url: `/api/v1/add-ons/${key}/look-up`, headers: as === '' ? {} : { cookie: cookies.get(as)! }, payload: { value } as never });
  const found = async (value: string, as = 'boss') => {
    const res = await look(value, as);
    expect(res.statusCode, res.body).toBe(200);
    // No reply carries a whole code, whoever asks.
    for (const code of CODES) expect(res.body, `${value} as ${as}`).not.toContain(code);
    return res.json() as Found;
  };
  const flag = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${name}@vault.dev`, name, passwordHash: await adminPasswordHash() });
    const roles = rolesRepo(h.meta);
    if (grants === 'super-admin') await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const [ref, actions] of Object.entries(grants)) {
        await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${tables.get(ref)!}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.1.0.${String(cookies.size + 1)}`, payload: { email: `${name}@vault.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(vaultKitManifest(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'vault', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    await h.rows(`INSERT INTO vault_gift_cards (id, code, kind, status, balance, recipient_name, owner_email) VALUES (1, '${CARD}', 'gift', 'active', 19.00, 'Noor', 'noor@example.com'), (2, '${MOVED}', 'gift', 'active', 5.00, NULL, NULL), (3, 'GC-AAAABBBBCCCC', 'credit', 'active', 12.50, NULL, 'sam@example.com'), (4, 'GC-DDDDEEEEFFFF', 'credit', 'spent', 0, NULL, 'sam@example.com')`);
    await h.rows(`INSERT INTO vault_card_ledger (id, card_id, kind, amount) VALUES (1, 1, 'issue', 25.00), (2, 1, 'spend', -6.00), (3, 3, 'issue', 12.50)`);
    await h.rows(`INSERT INTO vault_vouchers (id, code, worth, status, uses_left) VALUES (1, '${VOUCHER}', 'amount', 'active', 1), (2, '${PACK}', 'pack', 'active', 10)`);
    await h.rows(`INSERT INTO vault_redemptions (id, voucher_id, amount) VALUES (1, 2, 1.00)`);
    await h.rows(`INSERT INTO vault_codes (id, code, active, max_uses) VALUES (1, 'SUMMER10', ${flag(true)}, 100), (2, 'TWELVECHARS1', ${flag(true)}, NULL)`);
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'vault').execute()) {
      const model = (await (await import('@adminium/meta')).snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
      tables.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
    }
    // An owner's address is personal data: masked for anybody who may not read personal data.
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.pii', tableName: tables.get('gift_cards')!, columnName: 'owner_email', value: { masked: true }, origin: 'user' } as never);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    await person('boss', 'super-admin');
    // A desk reads cards in part and no history; a clerk reads vouchers alone.
    await person('desk', { gift_cards: { read: true, readLimit: { readable: ['id', 'kind', 'status', 'balance'] } }, codes: { read: true } });
    await person('clerk', { vouchers: { read: true }, redemptions: { read: true } });
    // Reads every column of a card, and may not read personal data.
    await person('teller', { gift_cards: { read: true } });
    await person('scanner', { codes: { read: true } });
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('a card, a voucher, a pack and a discount word are each found by their word', async () => {
    expect(await found('GC-7K2M-W3HN-Q4XP')).toMatchObject({ found: true, kind: 'gift-card', by: 'code', table: 'gift_cards', key: '1', last4: 'Q4XP' });
    expect(Number((await found('GC-7K2M-W3HN-Q4XP')).record!['balance'])).toBe(19);
    expect(await found(`VC-${VOUCHER}`)).toMatchObject({ found: true, kind: 'voucher', table: 'vouchers', key: '1', last4: '7K2M', record: { worth: 'amount', status: 'active' } });
    expect(await found(`PK-${PACK}`)).toMatchObject({ found: true, kind: 'pack', key: '2', last4: '9QXA', record: { worth: 'pack' } });
    expect(await found('SUMMER10')).toMatchObject({ found: true, kind: 'code', table: 'codes', key: '1', last4: null });
    // A word an owner typed may be four letters long: no part of it is answered.
  });

  it.skipIf(!available)('dashes, spaces and case do not matter; O is 0, I and L are 1', async () => {
    for (const typed of ['gc7k2mw3hnq4xp', 'GC 7K2M W3HN Q4XP', ' gc-7k2m-w3hn-q4xp ']) expect((await found(typed)).key, typed).toBe('1');
    // A voucher's code is read as Crockford reads one: the row holds 41TR, typed with a letter for each one.
    expect((await found('VC-9QXA-4ITR-7K2M')).key).toBe('1');
    expect((await found('vc 9qxa4ltr7k2m')).key).toBe('1');
  });

  it.skipIf(!available)('a card keeps its word and is found with or without its dash; a moved card of another length is found too', async () => {
    expect((await found('GC7K2MW3HNQ4XP')).key).toBe('1');
    expect(await found(MOVED)).toMatchObject({ found: true, kind: 'gift-card', key: '2', last4: '9930' });
  });

  it.skipIf(!available)('a voucher is stored without its word and found with it; PK finds a pack, and VC typed for the same row finds nothing', async () => {
    expect((await found(`VC-${VOUCHER}`)).found).toBe(true);
    expect(await found(`VC-${PACK}`)).toEqual({ found: false });
    expect(await found(`PK-${VOUCHER}`)).toEqual({ found: false });
  });

  it.skipIf(!available)('a value with no word is a discount word first, then a scanned voucher; a bare value is never a card', async () => {
    // What a voucher's QR holds: the bare twelve.
    expect(await found(VOUCHER)).toMatchObject({ found: true, kind: 'voucher', key: '1' });
    expect(await found(PACK)).toMatchObject({ found: true, kind: 'pack', key: '2' });
    // Twelve characters that are also a discount word: the word.
    expect(await found('TWELVECHARS1')).toMatchObject({ found: true, kind: 'code', key: '2' });
    // A card's twelve without its word find no card.
    expect(await found('7K2MW3HNQ4XP')).toEqual({ found: false });
  });

  it.skipIf(!available)('the answer carries the kind\'s history, newest first', async () => {
    const card = await found(CARD);
    expect(card.rows!.map((row) => [row['kind'], Number(row['amount'])])).toEqual([['spend', -6], ['issue', 25]]);
    expect(Object.keys(card.rows![0]!).sort()).toEqual(['amount', 'kind']);
    expect((await found('SUMMER10')).rows).toBeNull();
  });

  it.skipIf(!available)('credit is found by the customer\'s address, with the card table\'s own history — and says there are more', async () => {
    const credit = await found('  Sam@Example.com ');
    expect(credit).toMatchObject({ found: true, kind: 'address', by: 'address', table: 'gift_cards', key: '3', last4: null, more: 1, record: { kind: 'credit', status: 'active' } });
    expect(credit.rows!.map((row) => row['kind'])).toEqual(['issue']);
    expect(await found('nobody@example.com')).toEqual({ found: false });
    expect(await found('not an address@')).toEqual({ found: false });
  });

  it.skipIf(!available)('the desk\'s answer has only what its role reads, and no history it may not read', async () => {
    const card = await found(CARD, 'desk');
    expect(card).toMatchObject({ found: true, kind: 'gift-card', key: '1', last4: 'Q4XP', rows: null });
    expect(Object.keys(card.record!).sort()).toEqual(['balance', 'kind', 'status']);
    // The manager reads the rest — the address in clear, as Super Admin reads personal data.
    expect((await found(CARD)).record).toMatchObject({ recipient_name: 'Noor', owner_email: 'noor@example.com' });
  });

  it.skipIf(!available)('an address stays masked for somebody who may not read personal data, found by code or by address', async () => {
    const byCode = await found(CARD, 'teller');
    expect(byCode.record!['recipient_name']).toBe('Noor');
    expect(byCode.record!['owner_email']).not.toBe('noor@example.com');
    const byAddress = await found('noor@example.com', 'teller');
    expect(byAddress).toMatchObject({ found: true, key: '1' });
    expect(JSON.stringify(byAddress)).not.toContain('noor@example.com');
  });

  it.skipIf(!available)('the manifest row keeps the look-up as it was written', async () => {
    const row = await h.meta.db.selectFrom('adminium_manifests').select('manifest').where('manifestKey', '=', 'vault').executeTakeFirstOrThrow();
    const stored = (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) as { addOn: { lookUp: unknown } };
    expect(stored.addOn.lookUp).toEqual((vaultKitManifest() as { addOn: { lookUp: unknown } }).addOn.lookUp);
  });

  it.skipIf(!available || dialect !== 'sqlite')('the 61st in a minute is refused, per person', async () => {
    for (let n = 0; n < 60; n += 1) expect((await look('SUMMER10', 'scanner')).statusCode, String(n)).toBe(200);
    const over = await look('SUMMER10', 'scanner');
    expect(over.statusCode, over.body).toBe(429);
    expect((over.json() as { error: { details?: { bucket?: string } } }).error.details?.bucket).toBe('look-up');
    // Somebody else's budget is their own.
    expect((await look('SUMMER10', 'desk')).statusCode).toBe(200);
  });

  it.skipIf(!available)('a scanned voucher whose code starts with a routing word by chance is found all the same', async () => {
    await h.rows(`INSERT INTO vault_vouchers (id, code, worth, status, uses_left) VALUES (7, 'VC9QXA41TR7K', 'amount', 'active', 1), (8, 'GC9QXA41TR7K', 'pack', 'active', 3)`);
    expect(await found('VC9QXA41TR7K')).toMatchObject({ found: true, kind: 'voucher', key: '7' });
    expect(await found('VC-VC9QXA41TR7K')).toMatchObject({ found: true, kind: 'voucher', key: '7' });
    expect(await found('GC9QXA41TR7K')).toMatchObject({ found: true, kind: 'pack', key: '8' });
  });

  it.skipIf(!available)('an address is not searched by somebody whose role does not read that column', async () => {
    // The desk reads cards without their owner's address: an address it types finds nothing, whoever's it is.
    expect(await found('noor@example.com', 'desk')).toEqual({ found: false });
    expect(await found('sam@example.com', 'desk')).toEqual({ found: false });
  });

  it.skipIf(!available)('a table the caller may not read answers not found, as an unknown code does', async () => {
    expect(await found(`VC-${VOUCHER}`, 'desk')).toEqual({ found: false });
    expect(await found(CARD, 'clerk')).toEqual({ found: false });
    expect(await found('sam@example.com', 'clerk')).toEqual({ found: false });
    expect(await found('GC-ZZZZZZZZZZZZ')).toEqual({ found: false });
    // And the clerk finds what is theirs, history and all.
    expect(await found(`PK-${PACK}`, 'clerk')).toMatchObject({ found: true, kind: 'pack', rows: [{ amount: expect.anything() }] });
  });

  it.skipIf(!available)('text that is no code at all is not found, and nothing without a value is asked', async () => {
    for (const typed of ['héllo wörld', '***', 'a'.repeat(40)]) expect(await found(typed)).toEqual({ found: false });
    expect((await look('')).statusCode).toBe(422);
    expect((await look('x'.repeat(255))).statusCode).toBe(422);
    expect((await look(CARD, '')).statusCode).toBe(401);
  });

  it.skipIf(!available)('an add-on that is not here, or declares no look-up, is not found; one switched off says so', async () => {
    expect((await look(CARD, 'boss', 'no-such')).statusCode).toBe(404);
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'disabled' } as never).where('manifestKey', '=', 'vault').execute();
    const off = await look(CARD);
    expect(off.statusCode, off.body).toBe(409);
    expect((off.json() as { error: { code: string } }).error.code).toBe('FEATURE_OFF');
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'installed' } as never).where('manifestKey', '=', 'vault').execute();
    expect((await found(CARD)).found).toBe(true);
  });
});
