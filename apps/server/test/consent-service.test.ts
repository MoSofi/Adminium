// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent door (`src/consent/`) over a meta store on every engine: one
 * stop-list row per address as `normaliseAddress` spells it, entries that keep
 * matching through a change of `ADMINIUM_SECRET` and a new key version (an
 * erased person's included), a lookup that refuses rather than answers "not
 * on the list" when the keys cannot be read, and the log read by row or by
 * address.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addressKeysRepo, stopListRepo, type ConsentPerson } from '@adminium/meta';

import { AddressKeysLockedError, createConsentService, renewAddressKey, resealUnderNewSecret, type ConsentService } from '../src/consent/index.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'a-consent-test-secret-of-some-length';
const NEXT = 'the-secret-it-was-changed-to-later-on';
const marta: ConsentPerson = { connectionId: 'conn_1', table: 'public.contacts', key: '7' };
const dana = { id: 'usr_dana', label: 'Dana Whitlock' };

describe.each(META_ENGINES)('the consent door — $name', (engine) => {
  let handle: MetaHandle;
  let service: ConsentService;
  let clock = 1_000;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    for (const table of ['adminium_stop_list', 'adminium_consent_log', 'adminium_address_keys'] as const) await handle.meta.db.deleteFrom(table).execute();
    clock = 1_000;
    service = createConsentService({ meta: handle.meta, secret: SECRET, now: () => (clock += 1) });
  });

  it.runIf(engine.available)('keeps one entry for an address in any case and with spaces, and two for a+b@x and a@x', async () => {
    expect((await service.stop.add({ address: 'Marta.Kovac@Cobaltlegal.example', reason: 'link', origin: 'Spring newsletter' })).added).toBe(true);
    expect((await service.stop.add({ address: '  marta.kovac@cobaltlegal.example ', reason: 'hand', staff: dana })).added).toBe(false);
    expect((await service.stop.add({ address: 'MARTA.KOVAC@COBALTLEGAL.EXAMPLE', reason: 'spam' })).added).toBe(false);
    expect(await service.stop.count()).toBe(1);
    expect(await service.stop.has(' Marta.KOVAC@cobaltlegal.example')).toBe(true);

    // A tag and a dot are part of the address: never folded into another person's.
    expect((await service.stop.add({ address: 'a+b@x.example', reason: 'hand', staff: dana })).added).toBe(true);
    expect((await service.stop.add({ address: 'a@x.example', reason: 'hand', staff: dana })).added).toBe(true);
    expect((await service.stop.add({ address: 'a.b@x.example', reason: 'hand', staff: dana })).added).toBe(true);
    expect(await service.stop.count()).toBe(4);
    expect(await service.stop.has('ab@x.example')).toBe(false);
    expect([...(await service.stop.stoppedAmong(['A+B@x.example', 'ab@x.example', 'nobody@x.example', 'not an address']))]).toEqual(['a+b@x.example']);

    const listed = await service.stop.entryFor('marta.kovac@cobaltlegal.example');
    expect(listed).toMatchObject({ address: 'marta.kovac@cobaltlegal.example', reason: 'link', origin: 'Spring newsletter', addedBy: null, erasedAt: null });
    await expect(service.stop.add({ address: 'not an address', reason: 'hand' })).rejects.toThrow(/not an e-mail address/);
    await expect(service.stop.add({ address: 'x@y.example', reason: 'erased' })).rejects.toThrow(/erasure/);
  });

  it.runIf(engine.available)('keeps nothing in clear: a hash and an encrypted copy', async () => {
    await service.stop.add({ address: 'marta@cobaltlegal.example', reason: 'link' });
    await service.record({ address: 'marta@cobaltlegal.example', purpose: 'newsletter', state: 'yes', source: 'form' });
    const stored = JSON.stringify([
      await handle.meta.db.selectFrom('adminium_stop_list').selectAll().execute(),
      await handle.meta.db.selectFrom('adminium_consent_log').selectAll().execute(),
      await handle.meta.db.selectFrom('adminium_address_keys').selectAll().execute(),
    ]);
    expect(stored).not.toContain('marta');
    expect(stored).not.toContain('cobaltlegal');
  });

  it.runIf(engine.available)('lists newest first, finds by part of an address, narrows by why, and pages', async () => {
    for (let i = 0; i < 7; i += 1) await service.stop.add({ address: `person${String(i)}@shop.example`, reason: i % 2 === 0 ? 'hand' : 'bounce', staff: i % 2 === 0 ? dana : null, origin: i % 2 === 0 ? null : 'Mailgun' });
    await service.stop.add({ address: 'other@elsewhere.example', reason: 'hand', staff: dana });
    const all = await service.stop.list({ limit: 50 });
    expect(all.entries.map((entry) => entry.address)).toEqual(['other@elsewhere.example', ...[6, 5, 4, 3, 2, 1, 0].map((i) => `person${String(i)}@shop.example`)]);
    expect(all.next).toBeNull();
    expect(all.entries[0]!.addedBy).toEqual(dana);

    const found = await service.stop.list({ q: 'SHOP.example', limit: 3 });
    expect(found.entries.map((entry) => entry.address)).toEqual(['person6@shop.example', 'person5@shop.example', 'person4@shop.example']);
    const more = await service.stop.list({ q: 'shop.example', limit: 3, cursor: found.next });
    const last = await service.stop.list({ q: 'shop.example', limit: 3, cursor: more.next });
    expect([...more.entries, ...last.entries].map((entry) => entry.address)).toEqual([3, 2, 1, 0].map((i) => `person${String(i)}@shop.example`));
    expect(last.next).toBeNull();
    expect((await service.stop.list({ reason: 'bounce', limit: 50 })).entries.every((entry) => entry.origin === 'Mailgun')).toBe(true);
    expect(await service.stop.count('bounce')).toBe(3);
    await expect(service.stop.list({ limit: 5, cursor: 'nonsense' })).rejects.toThrow(/cursor/);
  });

  it.runIf(engine.available)('erases the display of an entry and keeps it matching; never takes it off the list', async () => {
    const { entry } = await service.stop.add({ address: 'gone@shop.example', reason: 'link' });
    expect(await service.eraseDisplay('Gone@Shop.example')).toBe('erased');
    expect(await service.stop.get(entry.id)).toMatchObject({ address: null, reason: 'link' });
    expect((await service.stop.get(entry.id))?.erasedAt).not.toBeNull();
    expect((await handle.meta.db.selectFrom('adminium_stop_list').select('addressEncrypted').where('id', '=', entry.id).executeTakeFirst())?.addressEncrypted).toBeNull();
    expect(await service.stop.has('gone@shop.example')).toBe(true);
    expect(await service.stop.remove(entry.id)).toBe('erased');
    expect(await service.stop.has('gone@shop.example')).toBe(true);
    // An erased person who never objected: put on the list, hash alone, only when asked.
    expect(await service.eraseDisplay('quiet@shop.example')).toBe('missing');
    expect(await service.stop.has('quiet@shop.example')).toBe(false);
    expect(await service.eraseDisplay('quiet@shop.example', { addIfMissing: true })).toBe('added');
    expect(await service.stop.entryFor('quiet@shop.example')).toMatchObject({ address: null, reason: 'erased' });
    // A plain entry comes off.
    const { entry: plain } = await service.stop.add({ address: 'back@shop.example', reason: 'hand', staff: dana });
    expect(await service.stop.remove(plain.id)).toBe('removed');
    expect(await service.stop.remove(plain.id)).toBe('missing');
    expect(await service.stop.has('back@shop.example')).toBe(false);
  });

  it.runIf(engine.available)('keeps every entry matching through a change of the secret, an erased one included', async () => {
    await service.stop.add({ address: 'kept@shop.example', reason: 'link' });
    await service.stop.add({ address: 'erased@shop.example', reason: 'spam' });
    await service.eraseDisplay('erased@shop.example');
    await service.record({ address: 'kept@shop.example', purpose: 'newsletter', state: 'no', source: 'unsubscribe' });

    // The secret changed with nothing re-encrypted: no answer, never a wrong "not on the list".
    const unready = createConsentService({ meta: handle.meta, secret: NEXT });
    await expect(unready.stop.has('kept@shop.example')).rejects.toBeInstanceOf(AddressKeysLockedError);
    await expect(unready.stop.has('nobody@shop.example')).rejects.toBeInstanceOf(AddressKeysLockedError);
    await expect(unready.stop.add({ address: 'new@shop.example', reason: 'hand' })).rejects.toBeInstanceOf(AddressKeysLockedError);
    await expect(unready.stateFor({ address: 'kept@shop.example' }, 'newsletter')).rejects.toBeInstanceOf(AddressKeysLockedError);
    expect(await addressKeysRepo(handle.meta).all()).toHaveLength(1);

    expect(await resealUnderNewSecret(handle.meta, { from: SECRET, to: NEXT })).toEqual({ keys: 1, entries: 1 });
    // Run again (cut short the first time, say): nothing left to do.
    expect(await resealUnderNewSecret(handle.meta, { from: SECRET, to: NEXT })).toEqual({ keys: 0, entries: 0 });
    const after = createConsentService({ meta: handle.meta, secret: NEXT });
    expect(await after.stop.has('KEPT@shop.example')).toBe(true);
    expect(await after.stop.has('erased@shop.example')).toBe(true);
    expect((await after.stop.entryFor('kept@shop.example'))?.address).toBe('kept@shop.example');
    expect((await after.stateFor({ address: 'kept@shop.example' }, 'newsletter')).state).toBe('no');
    // The old secret reads nothing now, and is refused rather than answered.
    await expect(createConsentService({ meta: handle.meta, secret: SECRET }).stop.has('kept@shop.example')).rejects.toBeInstanceOf(AddressKeysLockedError);
    // A reseal from a secret that never sealed them changes nothing and says so.
    await expect(resealUnderNewSecret(handle.meta, { from: 'wrong-wrong-wrong-wrong', to: 'another-one-entirely' })).rejects.toBeInstanceOf(AddressKeysLockedError);
    expect(await after.stop.has('kept@shop.example')).toBe(true);
  });

  it.runIf(engine.available)('keeps every entry matching under a new key version, an erased one under its old one', async () => {
    await service.stop.add({ address: 'kept@shop.example', reason: 'link' });
    await service.stop.add({ address: 'erased@shop.example', reason: 'spam' });
    await service.eraseDisplay('erased@shop.example');
    await service.record({ person: marta, address: 'kept@shop.example', purpose: 'newsletter', state: 'yes', source: 'form' });

    expect(await renewAddressKey(handle.meta, SECRET)).toEqual({ version: 2, rehashed: 1 });
    const versions = (await stopListRepo(handle.meta).scan({ limit: 10 })).map((entry) => [entry.addressEncrypted === null, entry.address.version]);
    expect(versions.sort()).toEqual([[false, 2], [true, 1]]);
    expect(await service.stop.has('kept@shop.example')).toBe(true);
    expect(await service.stop.has('erased@shop.example')).toBe(true);
    // A new entry is hashed under the newest version; the log's old rows are still found by address.
    const { entry: fresh } = await service.stop.add({ address: 'new@shop.example', reason: 'hand', staff: dana });
    expect((await stopListRepo(handle.meta).byId(fresh.id))?.address.version).toBe(2);
    expect((await service.stateFor({ address: 'kept@shop.example' }, 'newsletter')).state).toBe('yes');
    // And through a change of the secret after that, both versions still match.
    await resealUnderNewSecret(handle.meta, { from: SECRET, to: NEXT });
    const after = createConsentService({ meta: handle.meta, secret: NEXT });
    for (const address of ['kept@shop.example', 'erased@shop.example', 'new@shop.example']) expect(await after.stop.has(address)).toBe(true);
  });

  it.runIf(engine.available)('reads a person by row, by address, or both; the latest answer wins', async () => {
    expect(await service.stateFor({ person: marta }, 'newsletter')).toEqual({ purpose: 'newsletter', state: 'not-asked', event: null });
    const yes = await service.record({ person: marta, address: 'Marta@Shop.example', purpose: 'newsletter', state: 'yes', source: 'form', detail: 'Book a showroom visit', wording: { text: 'Send me news', version: 'v3' }, ip: '81.2.69.160', userAgent: 'Firefox', confirmedAt: 1_500 });
    expect(yes).toMatchObject({ person: marta, purpose: 'newsletter', state: 'yes', source: 'form', detail: 'Book a showroom visit', wording: 'Send me news', wordingVersion: 'v3', ip: '81.2.69.160', confirmedAt: 1_500, staffId: null });
    // An unsubscribe from a mail that knew only the address.
    await service.withdraw({ address: 'marta@shop.example', purpose: 'newsletter', source: 'unsubscribe', detail: 'link' });
    expect((await service.stateFor({ person: marta }, 'newsletter')).state).toBe('yes');
    expect((await service.stateFor({ address: 'MARTA@shop.example' }, 'newsletter')).state).toBe('no');
    expect((await service.stateFor({ person: marta, address: 'marta@shop.example' }, 'newsletter')).event).toMatchObject({ state: 'no', source: 'unsubscribe', person: null });
    expect((await service.stateFor({ person: marta, address: 'marta@shop.example' }, 'surveys')).state).toBe('not-asked');
    expect((await service.history({ person: marta, address: 'marta@shop.example' })).map((event) => event.state)).toEqual(['no', 'yes']);

    // A staff or review event names its staff member; any other names none.
    await expect(service.record({ person: marta, purpose: 'surveys', state: 'yes', source: 'staff' })).rejects.toThrow(/staff member/);
    await expect(service.record({ person: marta, purpose: 'surveys', state: 'yes', source: 'review' })).rejects.toThrow(/staff member/);
    const relayed = await service.withdraw({ address: 'marta@shop.example', purpose: 'surveys', source: 'relay', detail: 'Mailgun', staff: dana, how: 'phone', note: 'x' });
    expect(relayed).toMatchObject({ staffId: null, staffLabel: null, how: null, note: null });
    const staffed = await service.record({ person: marta, purpose: 'surveys', state: 'yes', source: 'staff', how: 'paper', note: 'Signed the card', staff: dana });
    expect(staffed).toMatchObject({ staffId: dana.id, staffLabel: dana.label, how: 'paper', note: 'Signed the card', address: null });
    await expect(service.record({ purpose: 'surveys', state: 'yes', source: 'form' })).rejects.toThrow(/names a person or an address/);
    await expect(service.record({ address: 'not an address', purpose: 'surveys', state: 'yes', source: 'form' })).rejects.toThrow(/not an e-mail address/);
  });

  it.runIf(engine.available)('says who was asked once, when they last replied, and deletes a person\'s events with them', async () => {
    const ben: ConsentPerson = { ...marta, key: '8' };
    expect(await service.askedOnce(marta)).toBe(false);
    await service.record({ person: marta, purpose: 'newsletter', state: 'yes', source: 'review', detail: 'before-records', staff: dana });
    expect(await service.askedOnce(marta)).toBe(true);
    expect(await service.askedOnce(marta, 'surveys')).toBe(false);
    expect([...(await service.askedAmong('conn_1', 'public.contacts', ['7', '8']))]).toEqual(['7']);

    expect(await service.lastReplied({ person: ben })).toBeNull();
    clock = 50_000;
    const replied = await service.markReplied({ person: ben, address: 'ben@shop.example', staff: dana });
    expect(replied).toMatchObject({ state: 'replied', purpose: null, source: 'staff', staffId: dana.id });
    expect(await service.lastReplied({ address: 'ben@shop.example' })).toBe(replied.at);
    // A reply is no answer: Ben was still never asked.
    expect(await service.askedOnce(ben)).toBe(false);

    await service.withdraw({ address: 'ben@shop.example', purpose: 'newsletter', source: 'bounce' });
    expect(await service.deleteForPerson({ person: ben, address: 'ben@shop.example' })).toBe(2);
    expect(await service.history({ person: ben, address: 'ben@shop.example' })).toEqual([]);
    expect(await service.askedOnce(marta)).toBe(true);
  });
});
