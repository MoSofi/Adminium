// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent log, the address keys (wave 0065) and the stop list (0066), on
 * every available dialect: the log only grows (its one delete is a person's
 * own rows), a person is found by their row or their address under any key
 * version, an address is one stop-list row per key version, and every bounded
 * column takes its full width.
 */
import { describe, expect, it } from 'vitest';

import {
  addressKeysRepo,
  consentLogRepo,
  stopListRepo,
  type ConsentEventInput,
  type ConsentPerson,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const marta: ConsentPerson = { connectionId: 'conn_1', table: 'public.contacts', key: '7' };
const ben: ConsentPerson = { connectionId: 'conn_1', table: 'public.contacts', key: '8' };
const h = (hash: string, version = 1) => ({ hash: hash.padEnd(64, '0'), version });

const event = (over: Partial<ConsentEventInput>): ConsentEventInput => ({
  person: marta,
  address: h('a1'),
  purpose: 'newsletter',
  state: 'yes',
  source: 'form',
  at: 1_000,
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`consent log and stop list [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('finds a person by their row, by their address under any version, and by either', async () => {
      const log = consentLogRepo(meta());
      await log.append(event({ at: 1_000, state: 'yes', source: 'form', detail: 'Book a showroom visit', wording: 'Send me news', wordingVersion: 'v3', ip: '81.2.69.160', userAgent: 'Firefox' }));
      // An unsubscribe that knew only the address, under the same key.
      await log.append(event({ person: null, at: 2_000, state: 'no', source: 'unsubscribe', detail: 'link' }));
      // Surveys: a staff member's yes, on the row alone.
      await log.append(event({ address: null, purpose: 'surveys', at: 1_500, source: 'staff', how: 'phone', note: 'Asked at the fair', staffId: 'usr_1', staffLabel: 'Dana Whitlock' }));

      expect((await log.latest({ person: marta }, 'newsletter'))?.state).toBe('yes');
      expect((await log.latest({ hashes: [h('a1')] }, 'newsletter'))).toMatchObject({ state: 'no', source: 'unsubscribe', person: null, address: h('a1') });
      expect((await log.latest({ person: marta, hashes: [h('a1')] }, 'newsletter'))?.state).toBe('no');
      expect(await log.latest({ person: marta, hashes: [h('a1')] }, 'surveys')).toMatchObject({ state: 'yes', how: 'phone', note: 'Asked at the fair', staffId: 'usr_1', staffLabel: 'Dana Whitlock', address: null });
      // Another version of the key, another person, another address: nothing.
      expect(await log.latest({ hashes: [h('a1', 2)] }, 'newsletter')).toBeNull();
      expect(await log.latest({ person: ben }, 'newsletter')).toBeNull();
      expect(await log.latest({}, 'newsletter')).toBeNull();

      const history = await log.history({ person: marta, hashes: [h('a1')] }, { limit: 10 });
      expect(history.map((row) => [row.at, row.state])).toEqual([[2_000, 'no'], [1_500, 'yes'], [1_000, 'yes']]);
      expect(history[2]).toMatchObject({ detail: 'Book a showroom visit', wording: 'Send me news', wordingVersion: 'v3', ip: '81.2.69.160', userAgent: 'Firefox', confirmedAt: null });
      expect(history[0]!.id.startsWith('cns_')).toBe(true);
      const paged = await log.history({ person: marta, hashes: [h('a1')] }, { limit: 1, before: { at: history[0]!.at, id: history[0]!.id } });
      expect(paged.map((row) => row.at)).toEqual([1_500]);
    });

    it('takes the newest of two events at one moment by id, and reads "replied" apart', async () => {
      const log = consentLogRepo(meta());
      await log.append(event({ at: 5_000, state: 'yes' }));
      await log.append(event({ at: 5_000, state: 'no', source: 'staff', staffId: 'usr_1', staffLabel: 'Dana' }));
      expect((await log.latest({ person: marta }, 'newsletter'))?.state).toBe('no');
      expect(await log.lastReplied({ person: marta })).toBeNull();
      await log.append(event({ purpose: null, state: 'replied', source: 'staff', at: 6_000, staffId: 'usr_1', staffLabel: 'Dana' }));
      await log.append(event({ purpose: null, state: 'replied', source: 'staff', at: 4_000, staffId: 'usr_1', staffLabel: 'Dana' }));
      expect(await log.lastReplied({ person: marta })).toBe(6_000);
      expect(await log.lastReplied({ hashes: [h('a1')] })).toBe(6_000);
      // A "replied" is no answer to a purpose.
      expect((await log.latest({ person: marta }, 'newsletter'))?.state).toBe('no');
    });

    it('refuses an event about nobody, a purposeless yes, a purposed reply, and a key too long to keep', async () => {
      const log = consentLogRepo(meta());
      await expect(log.append(event({ person: null, address: null }))).rejects.toThrow(/names a person/);
      await expect(log.append(event({ purpose: null }))).rejects.toThrow(/one purpose/);
      await expect(log.append(event({ state: 'replied' }))).rejects.toThrow(/one purpose/);
      await expect(log.append(event({ person: { ...marta, key: 'k'.repeat(201) } }))).rejects.toThrow(/1 to 200/);
    });

    it('only grows: no method changes a row, and the one delete is a person\'s own rows', async () => {
      const log = consentLogRepo(meta());
      expect(Object.keys(log).sort()).toEqual(['answeredAmong', 'append', 'deleteForPerson', 'history', 'lastReplied', 'latest', 'latestAmong']);
      await log.append(event({}));
      await log.append(event({ person: null, at: 2_000, state: 'no', source: 'unsubscribe' }));
      await log.append(event({ person: ben, address: h('b1'), at: 3_000 }));
      await log.append(event({ person: null, address: h('b1'), at: 4_000, state: 'no', source: 'bounce' }));
      // The row alone: its address-only events stay.
      expect(await log.deleteForPerson({ person: marta })).toBe(1);
      expect((await log.history({ hashes: [h('a1')] }, { limit: 10 })).map((row) => row.source)).toEqual(['unsubscribe']);
      // The row and its address: everything of Ben's, nothing of anyone else's.
      expect(await log.deleteForPerson({ person: ben, hashes: [h('b1')] })).toBe(2);
      expect(await log.history({ person: ben, hashes: [h('b1')] }, { limit: 10 })).toEqual([]);
      expect(await log.history({ hashes: [h('a1')] }, { limit: 10 })).toHaveLength(1);
      expect(await log.deleteForPerson({})).toBe(0);
    });

    it('says which rows of a table were asked, for a purpose or any', async () => {
      const log = consentLogRepo(meta());
      await log.append(event({}));
      await log.append(event({ person: ben, purpose: 'surveys', state: 'no' }));
      await log.append(event({ person: { ...ben, key: '9' }, purpose: null, state: 'replied', source: 'staff' }));
      expect([...(await log.answeredAmong('conn_1', 'public.contacts', ['7', '8', '9', '10']))].sort()).toEqual(['7', '8']);
      expect([...(await log.answeredAmong('conn_1', 'public.contacts', ['7', '8'], 'newsletter'))]).toEqual(['7']);
      expect((await log.answeredAmong('conn_2', 'public.contacts', ['7'])).size).toBe(0);
    });

    it('writes every bounded column of the log at its full width', async () => {
      const log = consentLogRepo(meta());
      const wide = event({
        person: { connectionId: 'c'.repeat(36), table: 't'.repeat(200), key: 'k'.repeat(200) },
        address: { hash: 'f'.repeat(64), version: 2_147_483_647 },
        purpose: 'p'.repeat(40) as never,
        state: 'r'.repeat(12) as never,
        source: 's'.repeat(20) as never,
        detail: 'd'.repeat(255),
        how: 'h'.repeat(20) as never,
        note: 'n'.repeat(20_000),
        staffId: 'u'.repeat(36),
        staffLabel: 'l'.repeat(255),
        wording: 'w'.repeat(70_000),
        wordingVersion: 'v'.repeat(40),
        ip: 'i'.repeat(64),
        userAgent: 'a'.repeat(512),
        at: 1_790_000_000_000,
        confirmedAt: 1_790_000_000_001,
      });
      const appended = await log.append(wide);
      const [back] = await log.history({ person: wide.person }, { limit: 1 });
      expect(back).toMatchObject({ ...wide, id: appended.id, person: wide.person, address: wide.address });
      // A longer browser string or form name is cut, not refused.
      const cut = await log.append(event({ detail: 'd'.repeat(300), userAgent: 'a'.repeat(600), ip: 'i'.repeat(70), staffLabel: 'l'.repeat(300), wordingVersion: 'v'.repeat(50) }));
      expect(cut).toMatchObject({ detail: 'd'.repeat(255), userAgent: 'a'.repeat(512), ip: 'i'.repeat(64), staffLabel: 'l'.repeat(255), wordingVersion: 'v'.repeat(40) });
    });

    it('keeps the address keys by version: one per version, re-encrypted in place', async () => {
      const keys = addressKeysRepo(meta());
      expect(await keys.all()).toEqual([]);
      expect(await keys.create({ version: 2, keyEncrypted: 'enc:v1:two', createdAt: 20 })).toBe(true);
      expect(await keys.create({ version: 1, keyEncrypted: 'enc:v1:one', createdAt: 10 })).toBe(true);
      expect(await keys.create({ version: 1, keyEncrypted: 'enc:v1:other', createdAt: 30 })).toBe(false);
      await keys.reseal(1, `enc:v1:${'x'.repeat(5_000)}`);
      expect(await keys.all()).toEqual([
        { version: 1, keyEncrypted: `enc:v1:${'x'.repeat(5_000)}`, createdAt: 10 },
        { version: 2, keyEncrypted: 'enc:v1:two', createdAt: 20 },
      ]);
    });

    it('keeps an address once per key version, newest first, and lets an erased one keep its hash alone', async () => {
      const list = stopListRepo(meta());
      const first = await list.add({ address: h('a1'), addressEncrypted: 'enc:v1:a', reason: 'link', origin: 'Spring newsletter', addedAt: 1_000 });
      expect(first.added).toBe(true);
      expect(first.entry.id.startsWith('stp_')).toBe(true);
      // The same hash again: the first row, untouched.
      const again = await list.add({ address: h('a1'), addressEncrypted: 'enc:v1:other', reason: 'hand', addedAt: 2_000, addedById: 'usr_1', addedByLabel: 'Dana' });
      expect(again).toEqual({ entry: first.entry, added: false });
      // The same hash under another version is another row.
      await list.add({ address: h('a1', 2), addressEncrypted: 'enc:v1:a2', reason: 'bounce', origin: 'Mailgun', addedAt: 3_000 });
      await list.add({ address: h('b1'), addressEncrypted: 'enc:v1:b', reason: 'hand', addedAt: 3_000, addedById: 'usr_1', addedByLabel: 'Dana' });
      expect(await list.count()).toBe(3);
      expect(await list.count('hand')).toBe(1);

      const page = await list.page({ limit: 10 });
      expect(page.map((entry) => entry.addedAt)).toEqual([3_000, 3_000, 1_000]);
      const firstTwo = await list.page({ limit: 2 });
      const rest = await list.page({ limit: 2, after: { addedAt: firstTwo[1]!.addedAt, id: firstTwo[1]!.id } });
      expect([...firstTwo, ...rest].map((entry) => entry.id)).toEqual(page.map((entry) => entry.id));
      expect((await list.page({ limit: 10, reason: 'bounce' })).map((entry) => entry.origin)).toEqual(['Mailgun']);
      expect((await list.findAny([h('a1'), h('b1'), h('zz')])).map((entry) => entry.address.hash).sort()).toEqual([h('a1').hash, h('b1').hash].sort());
      expect(await list.findAny([])).toEqual([]);

      await list.eraseDisplay(first.entry.id, 9_000);
      expect(await list.byHash(h('a1'))).toMatchObject({ addressEncrypted: null, erasedAt: 9_000, reason: 'link' });
      await list.reseal((await list.byHash(h('b1')))!.id, 'enc:v1:b-again');
      expect((await list.byHash(h('b1')))?.addressEncrypted).toBe('enc:v1:b-again');

      // Re-hashed onto a hash that is on the list already: refused, for the caller to drop the row.
      const b = (await list.byHash(h('b1')))!;
      expect(await list.rehash(b.id, h('a1', 2))).toBe(false);
      expect(await list.rehash(b.id, h('b1', 3))).toBe(true);
      expect(await list.byHash(h('b1', 3))).toMatchObject({ id: b.id });

      const scanned = [...(await list.scan({ limit: 2 }))];
      scanned.push(...(await list.scan({ afterId: scanned.at(-1)!.id, limit: 2 })));
      expect(scanned.map((entry) => entry.id)).toEqual([...page.map((entry) => entry.id)].sort());
      expect(await list.remove(b.id)).toBe(true);
      expect(await list.remove(b.id)).toBe(false);
      expect(await list.byId(b.id)).toBeNull();
    });

    it('writes every bounded column of the stop list at its full width', async () => {
      const list = stopListRepo(meta());
      const { entry } = await list.add({
        address: { hash: 'f'.repeat(64), version: 2_147_483_647 },
        addressEncrypted: `enc:v1:${'x'.repeat(70_000)}`,
        reason: 'r'.repeat(20) as never,
        origin: 'o'.repeat(255),
        addedAt: 1_790_000_000_000,
        addedById: 'u'.repeat(36),
        addedByLabel: 'l'.repeat(255),
      });
      await list.eraseDisplay(entry.id, 1_790_000_000_001);
      expect(await list.byId(entry.id)).toEqual({ ...entry, addressEncrypted: null, erasedAt: 1_790_000_000_001 });
      const cut = await list.add({ address: h('c1'), addressEncrypted: null, reason: 'hand', origin: 'o'.repeat(300), addedAt: 1, addedByLabel: 'l'.repeat(300) });
      expect(cut.entry).toMatchObject({ origin: 'o'.repeat(255), addedByLabel: 'l'.repeat(255) });
    });
  });
}
