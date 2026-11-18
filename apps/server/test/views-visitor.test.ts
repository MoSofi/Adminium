// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Per visitor"'s parts (`views/visitor.ts`): the cookie is read only under
 * its own name for the address it came on, and only a value this server
 * signed (a planted, made-up or changed one names nobody); it is
 * `__Host-adm_v` on the whole host over https; a "yes" with no row yet counts
 * for an hour; the id kept is a keyed hash, never the value; the banner's words are the
 * engine's default in each of the eight languages until the owner writes
 * their own, field by field, and the wording version follows the words; and
 * only the install's public address and a mapped pages host are its own
 * pages.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, settingsRepo, visitorsRepo, type MetaDb } from '@adminium/meta';

import { addressKeyRing } from '../src/consent/keys.js';

import {
  bannerLocaleOf,
  bannerWords,
  BANNER_DEFAULT,
  clearVisitorCookie,
  createVisitorDoor,
  newVisitor,
  NEW_VISITORS_PER_48_DAY,
  NEW_VISITORS_PER_ADDRESS_DAY,
  ownPagesHost,
  pendingYes,
  readVisitorValue,
  setVisitorCookie,
  visitorIdOf,
  visitorKey,
  visitorProofOf,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_S,
  VISITOR_PENDING_MS,
  type VisitorProof,
} from '../src/views/visitor.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const T0 = Date.UTC(2026, 10, 18, 10, 0, 0);
const WORDING = `w-${'0123456789ab'.repeat(2)}`;

describe('the visitor\'s cookie and banner', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });

  it('reads the cookie by the name its address gives it, and keeps only a keyed hash of its value', () => {
    const key = visitorKey(TEST_SECRET);
    const made = newVisitor(key, { at: T0, wordingVersion: WORDING });
    expect(made.value).toMatch(/^[A-Za-z0-9_-]{67}$/);
    expect(made.proof).toEqual({ id: expect.stringMatching(/^[0-9a-f]{64}$/), saidYesAt: T0, wordingVersion: WORDING });
    expect(made.proof.id).not.toContain(made.value);
    expect(visitorIdOf(key, { protocol: 'https', headers: { cookie: `adminium_session=s; ${VISITOR_COOKIE}=${made.value}` } })).toBe(made.proof.id);
    // What the cookie proves: when the yes was said, and to which words.
    expect(visitorProofOf(key, { protocol: 'https', headers: { cookie: `${VISITOR_COOKIE}=${made.value}` } })).toEqual(made.proof);
    // The plain-http name is not read on https, nor the https name on http.
    expect(visitorIdOf(key, { protocol: 'https', headers: { cookie: `adm_v=${made.value}` } })).toBeNull();
    expect(visitorIdOf(key, { protocol: 'http', headers: { cookie: `adm_v=${made.value}` } })).toBe(made.proof.id);
    // A value that is no visitor's shape names nobody; another secret, nobody either.
    expect(visitorIdOf(key, { protocol: 'https', headers: { cookie: `${VISITOR_COOKIE}=<script>` } })).toBeNull();
    expect(visitorIdOf(visitorKey(`${TEST_SECRET}x`), { protocol: 'https', headers: { cookie: `${VISITOR_COOKIE}=${made.value}` } })).toBeNull();
    // At most six months.
    expect(VISITOR_COOKIE_MAX_AGE_S).toBeLessThanOrEqual(183 * 24 * 60 * 60);
  });

  it('names nobody by a value this server did not make: planted from a sibling host, made up, or changed by one character', () => {
    const key = visitorKey(TEST_SECRET);
    const made = newVisitor(key, { at: T0, wordingVersion: WORDING });
    const read = (value: string) => readVisitorValue(key, value);
    expect(read(made.value)).not.toBeNull();
    // The old shape (a bare random value), a random value of the right length, and every one-character change.
    expect(read('Qm9vdGhzQW5kRGVza3NMZWVkcw')).toBeNull();
    expect(read(Buffer.alloc(50, 7).toString('base64url'))).toBeNull();
    for (let at = 0; at < made.value.length; at += 1) {
      const swapped = `${made.value.slice(0, at)}${made.value[at] === 'A' ? 'B' : 'A'}${made.value.slice(at + 1)}`;
      expect(read(swapped), String(at)).toBeNull();
    }
    // A "yes" moved to another moment or other words is a change too.
    const bytes = Buffer.from(made.value, 'base64url');
    bytes.writeUIntBE(T0 + 1, 16, 6);
    expect(read(bytes.toString('base64url'))).toBeNull();
    expect(() => newVisitor(key, { at: T0, wordingVersion: 'w1' })).toThrow();
  });

  it('sets the cookie as __Host-adm_v on the whole host over https, and adm_v on /x/ over plain http', () => {
    const headers: Record<string, string> = {};
    const reply = { header: (name: string, value: string) => void (headers[name] = value) } as never;
    setVisitorCookie({ protocol: 'https' }, reply, 'V');
    expect(headers['set-cookie']).toBe('__Host-adm_v=V; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure');
    // The prefix's own rules: Secure, Path=/, and never a Domain (a sibling host cannot plant one).
    expect(headers['set-cookie']).not.toMatch(/domain=/i);
    clearVisitorCookie({ protocol: 'https' }, reply);
    expect(headers['set-cookie']).toBe('__Host-adm_v=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    setVisitorCookie({ protocol: 'http' }, reply, 'V');
    expect(headers['set-cookie']).toBe('adm_v=V; Path=/x/; Max-Age=15552000; HttpOnly; SameSite=Lax');
    expect(VISITOR_COOKIE).toBe('__Host-adm_v');
  });

  it('counts a "yes" with no row yet for an hour after it was said, never one from ahead of the clock', () => {
    expect(pendingYes({ saidYesAt: T0 }, T0)).toBe(true);
    expect(pendingYes({ saidYesAt: T0 }, T0 + VISITOR_PENDING_MS - 1)).toBe(true);
    expect(pendingYes({ saidYesAt: T0 }, T0 + VISITOR_PENDING_MS)).toBe(false);
    expect(pendingYes({ saidYesAt: T0 + 10 * 60_000 }, T0)).toBe(false);
    expect(VISITOR_PENDING_MS).toBeLessThanOrEqual(60 * 60_000);
  });

  it('words the banner with the engine\'s default in each language until the owner writes their own, and versions the words', async () => {
    const english = await bannerWords(meta, 'en-US');
    expect(english).toMatchObject({ ...BANNER_DEFAULT, language: 'en-US' });
    const german = await bannerWords(meta, 'de-DE');
    expect(german.title).toBe('Dürfen wir uns an Ihren Besuch erinnern?');
    // The German default never says "notieren".
    expect(german.text).not.toMatch(/notier/i);
    const arabic = await bannerWords(meta, 'ar-EG');
    expect(arabic.title).toBe('هل نتذكر زيارتك؟');
    await settingsRepo(meta).set('privacy.banner', { 'en-US': { yes: 'Sure' } });
    const owned = await bannerWords(meta, 'en-US');
    expect(owned).toMatchObject({ title: BANNER_DEFAULT.title, yes: 'Sure', no: 'No' });
    expect(owned.version).not.toBe(english.version);
    expect(owned.version.length).toBeLessThanOrEqual(32);
    // Another language keeps its default and its version.
    expect((await bannerWords(meta, 'de-DE')).version).toBe(german.version);
    expect([bannerLocaleOf('de-DE'), bannerLocaleOf('de'), bannerLocaleOf('pt-BR'), bannerLocaleOf(null)]).toEqual(['de-DE', 'de-DE', 'en-US', 'en-US']);
  });

  it('counts only the public address and a mapped pages host as the install\'s own pages', async () => {
    const settings = settingsRepo(meta);
    expect(await ownPagesHost(meta, { host: 'crm.meridian.example' })).toBe(false);
    await settings.set('system.publicOrigin', 'https://crm.meridian.example');
    await settings.set('surfaces.pageHosts', { 'pages.meridian.example': { home: '/x/pages/home' } });
    expect(await ownPagesHost(meta, { host: 'crm.meridian.example' })).toBe(true);
    expect(await ownPagesHost(meta, { host: 'CRM.Meridian.example' })).toBe(true);
    expect(await ownPagesHost(meta, { host: 'pages.meridian.example' })).toBe(true);
    expect(await ownPagesHost(meta, { host: 'shop.meridian.example' })).toBe(false);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`a "yes" becomes a visitor only with a counted view, capped, and an address never overwrites another [${engine.name}]`, () => {
    let handle: MetaHandle;
    let at = T0;
    beforeEach(async () => {
      handle = await engine.make();
      at = T0;
      // "Per visitor" switched on a moment before.
      await settingsRepo(handle.meta).set('privacy.tracking', 'visitor', { updatedBy: null, at: T0 - 60_000 });
    });
    afterEach(async () => {
      await handle.destroy();
    });

    const door = () => {
      const ring = addressKeyRing(handle.meta, TEST_SECRET);
      return createVisitorDoor({
        meta: handle.meta,
        secret: TEST_SECRET,
        level: () => 'visitor',
        levelNow: async () => 'visitor',
        hashForWrite: (address) => ring.hashForWrite(address),
        hashesOf: (address) => ring.hashesOf(address),
        now: () => at,
      });
    };
    const newcomer = (proof: VisitorProof, address = 'net-a', wide: string | null = null, host = 'pages.meridian.example') => ({ proof, host, at, networks: { address, wide } });
    const reply = () => {
      const headers: Record<string, string> = {};
      return { headers, reply: { header: (name: string, value: string) => void (headers[name] = value) } as never };
    };

    it('writes nothing for a "yes" alone, then the visitor with its proof at its first counted view, within the hour', async () => {
      const visitors = door();
      const key = visitorKey(TEST_SECRET);
      const yes = newVisitor(key, { at: T0, wordingVersion: WORDING });
      expect((await visitorsRepo(handle.meta).counts()).visitors).toBe(0);
      at = T0 + 30 * 60_000;
      expect([...(await visitors.admit([newcomer(yes.proof, 'net-a', null, `${'h'.repeat(240)}.example`)]))]).toEqual([yes.proof.id]);
      // The full width of the host, the proof's moment and words, no address.
      expect(await visitorsRepo(handle.meta).find(yes.proof.id)).toMatchObject({ host: `${'h'.repeat(240)}.example`, saidYesAt: T0, wordingVersion: WORDING, address: null });
      // A visitor kept is left as it is.
      expect([...(await visitors.admit([newcomer(yes.proof)]))]).toEqual([yes.proof.id]);
      expect((await visitorsRepo(handle.meta).counts()).visitors).toBe(1);
      // A "yes" whose first view came past the hour, or one said before "Per visitor" was switched on, becomes nobody.
      const late = newVisitor(key, { at: T0, wordingVersion: WORDING });
      at = T0 + VISITOR_PENDING_MS;
      expect([...(await visitors.admit([newcomer(late.proof)]))]).toEqual([]);
      const before = newVisitor(key, { at: T0 - 120_000, wordingVersion: WORDING });
      at = T0;
      expect([...(await visitors.admit([newcomer(before.proof)]))]).toEqual([]);
      expect((await visitorsRepo(handle.meta).counts()).visitors).toBe(1);
    });

    it('makes at most twenty new visitors a day from one network address, and two hundred from one /48', async () => {
      const visitors = door();
      const key = visitorKey(TEST_SECRET);
      const many = (count: number, address: (n: number) => string, wide: string | null) => Array.from({ length: count }, (_, n) => newcomer(newVisitor(key, { at: T0, wordingVersion: WORDING }).proof, address(n), wide));
      expect((await visitors.admit(many(NEW_VISITORS_PER_ADDRESS_DAY + 5, () => 'one-address', null))).size).toBe(NEW_VISITORS_PER_ADDRESS_DAY);
      // Another address: its own twenty.
      expect((await visitors.admit(many(3, () => 'another', null))).size).toBe(3);
      // Rotating through a /48's /64s: two hundred in all.
      expect((await visitors.admit(many(NEW_VISITORS_PER_48_DAY + 10, (n) => `rotated-${String(n)}`, 'one-48'))).size).toBe(NEW_VISITORS_PER_48_DAY);
      // The next day, again.
      at = T0 + 24 * 60 * 60_000;
      const tomorrow = Array.from({ length: 2 }, () => newcomer(newVisitor(key, { at, wordingVersion: WORDING }).proof, 'one-address'));
      expect((await visitors.admit(tomorrow)).size).toBe(2);
      expect((await visitorsRepo(handle.meta).counts()).visitors).toBe(NEW_VISITORS_PER_ADDRESS_DAY + 3 + NEW_VISITORS_PER_48_DAY + 2);
    });

    it('joins the first address; a second address from the same browser starts a new visitor and keeps the first apart', async () => {
      const visitors = door();
      const key = visitorKey(TEST_SECRET);
      const yes = newVisitor(key, { at: T0, wordingVersion: WORDING });
      const request = (value: string) => ({ protocol: 'https' as const, host: 'pages.meridian.example', headers: { cookie: `${VISITOR_COOKIE}=${value}` } });
      // A "yes" still waiting: its row is made with the address.
      const first = reply();
      await visitors.join(request(yes.value), first.reply, 'alice@meridian.example');
      expect(first.headers['set-cookie']).toBeUndefined();
      const alice = (await visitorsRepo(handle.meta).find(yes.proof.id))!;
      expect(alice.address).not.toBeNull();
      await visitorsRepo(handle.meta).addVisits([{ visitorId: yes.proof.id, installId: 'mf_pages', kind: 'page', thing: '7', at: T0 }]);
      // The same address again, in another case: nothing changes.
      const again = reply();
      await visitors.join(request(yes.value), again.reply, 'Alice@Meridian.example');
      expect(again.headers['set-cookie']).toBeUndefined();
      // Another address: a new visitor and a new cookie; the first keeps its address and its visits.
      const second = reply();
      await visitors.join(request(yes.value), second.reply, 'bob@meridian.example');
      const set = second.headers['set-cookie']!;
      expect(set).toMatch(/^__Host-adm_v=[A-Za-z0-9_-]{67}; Path=\/;/);
      const bob = visitorProofOf(key, { protocol: 'https', headers: { cookie: set.split(';')[0]! } })!;
      expect(bob.id).not.toBe(yes.proof.id);
      expect(bob).toMatchObject({ saidYesAt: T0, wordingVersion: WORDING });
      expect((await visitorsRepo(handle.meta).find(yes.proof.id))!.address).toEqual(alice.address);
      const bobRow = (await visitorsRepo(handle.meta).find(bob.id))!;
      expect(bobRow.address).not.toBeNull();
      expect(bobRow.address).not.toEqual(alice.address);
      expect((await visitorsRepo(handle.meta).visitsOf([yes.proof.id], 10)).count).toBe(1);
      expect((await visitorsRepo(handle.meta).visitsOf([bob.id], 10)).count).toBe(0);
      // A cookie this server did not make joins nothing.
      const planted = reply();
      await visitors.join(request('Qm9vdGhzQW5kRGVza3NMZWVkcw'), planted.reply, 'carol@meridian.example');
      expect((await visitorsRepo(handle.meta).counts()).visitors).toBe(2);
    });
  });
}
