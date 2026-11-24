// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Text consent over a meta store on every engine: what refuses a text, what a
 * STOP and a START do, a person known only by phone, their erasure, and what
 * is never kept in clear. The rules that need no store run once, outside the
 * engine loop.
 */
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { addressKeysRepo, type ConsentPerson } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SourceDatabase } from '../src/connections/manager.js';
import { AddressKeysLockedError, createConsentService, renewAddressKey, resealUnderNewSecret } from '../src/consent/index.js';
import { addressKeysWrapKey } from '../src/consent/keys.js';
import { decryptSecret } from '../src/config/secrets.js';
import { parsePhone } from '../src/phone/index.js';
import {
  createTextConsentService,
  createTextConsentStore,
  findRowsByPhone,
  maskPhone,
  NO_REPLY_COUNTRIES,
  redactPhones,
  textSubject,
  type TextConsentService,
  type TextConsentStore,
  type TextDecision,
  type TextRequest,
} from '../src/sms/consent/index.js';
import { judgeBeforeLookup } from '../src/sms/consent/rules.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'a-text-consent-test-secret-of-some-length';
const NEXT = 'the-secret-it-was-changed-to-later-on';
const DE = '+4915123456789';
const DE_OTHER = '+4915123456780';
const GB = '+447400123456';
const US = '+12015550123';
const AE = '+971501234567';
const EG = '+201001234567';
const SA = '+966512345678';
const CN = '+8613123456789';
const TW = '+886912345678';
const HK = '+85251234567';
const MO = '+85366123456';
/** The right shape, in a range the phone library does not know. */
const UNKNOWN_RANGE = '+15550000000';
/** A valid US number whose digits are the tail of {@link DE}. */
const FUZZY_TWIN = '+15123456789';

const marta: ConsentPerson = { connectionId: 'conn_1', table: 'public.members', key: '7' };
const dana = { id: 'usr_dana', label: 'Dana Whitlock' };
const wording = { text: 'Text me about my bookings.', version: 'v3' };
const marketingWords = { text: 'Text me offers.', version: 'v1' };

const serviceFrom = (phone: unknown, more: Partial<TextRequest> = {}): TextRequest => ({ phone, country: null, class: 'service', sender: { kind: 'number' }, repliesReachUs: true, ...more });
const marketingFrom = (phone: unknown, more: Partial<TextRequest> = {}): TextRequest => serviceFrom(phone, { class: 'marketing', ...more });
const refusal = (decision: TextDecision): string | null => (decision.send ? null : decision.reason);

describe('what refuses a text before any store is read', () => {
  const judge = (phone: unknown, request: Partial<TextRequest> = {}) => {
    const judged = judgeBeforeLookup(parsePhone(phone, request.country ?? null), { class: 'service', sender: { kind: 'number' }, repliesReachUs: true, ...request });
    return judged.pass ? null : judged.refusal.reason;
  };

  it.each([[undefined], [null], [''], ['   '], ['12345'], ['not a phone'], [4915123456789], ['+999123'], [{}]])('refuses %j as unreadable, for service and marketing', (value) => {
    expect(judge(value)).toBe('unreadable-phone');
    expect(judge(value, { class: 'marketing' })).toBe('unreadable-phone');
  });

  it('names why the number could not be read', () => {
    const judged = judgeBeforeLookup(parsePhone('0151 23456789', null), { class: 'service', sender: { kind: 'number' }, repliesReachUs: true });
    expect(judged).toMatchObject({ pass: false, refusal: { reason: 'unreadable-phone', phoneReason: 'needs-country' } });
  });

  it('refuses a landline and a number with an extension', () => {
    expect(judge('+493012345678')).toBe('cannot-receive-text');
    expect(judge(`${DE} ext 12`)).toBe('cannot-receive-text');
  });

  it('refuses every text to +86, and neither Hong Kong, Macao nor Taiwan with it', () => {
    expect(judge(CN)).toBe('country-blocked');
    expect(judge(CN, { class: 'marketing' })).toBe('country-blocked');
    expect(judge(HK)).toBeNull();
    expect(judge(MO)).toBeNull();
    expect(judge(TW)).toBeNull();
    expect(judge(HK, { class: 'marketing' })).toBeNull();
  });

  it.each([[AE], [EG], [SA], [TW]])('keeps service texts to %s and refuses marketing there', (phone) => {
    expect(judge(phone)).toBeNull();
    expect(judge(phone, { class: 'marketing' })).toBe('country-blocked-for-marketing');
  });

  it('holds the five countries the ruling names, no more and no fewer', () => {
    expect([...NO_REPLY_COUNTRIES].sort()).toEqual(['AE', 'CN', 'EG', 'SA', 'TW']);
  });

  it('refuses marketing from a sender name, and allows a service text from one', () => {
    expect(judge(DE, { class: 'marketing', sender: { kind: 'name' } })).toBe('marketing-from-name');
    expect(judge(DE, { sender: { kind: 'name' } })).toBeNull();
    expect(judge(DE, { class: 'marketing', sender: { kind: 'shortcode' } as unknown as TextRequest['sender'] })).toBe('marketing-from-name');
  });

  it('refuses marketing from a server that cannot read a STOP, and keeps service texts there', () => {
    expect(judge(DE, { class: 'marketing', repliesReachUs: false })).toBe('marketing-without-replies');
    expect(judge(DE, { repliesReachUs: false })).toBeNull();
  });

  it('refuses a class it does not know', () => {
    expect(judge(DE, { class: 'transactional' as unknown as TextRequest['class'] })).toBe('unknown-class');
  });
});

describe('redaction', () => {
  it('shows a number as its code and last three digits, and nothing of anything else', () => {
    expect(maskPhone(DE)).toBe('+49 ••• 789');
    expect(maskPhone(GB)).toBe('+44 ••• 456');
    for (const value of ['0151 23456789', 'marta@example.test', '12345', null, undefined, 4915123456789, {}]) expect(maskPhone(value)).toBe('•••');
  });

  it('masks a number written with a plus inside a sentence, however it is spaced', () => {
    for (const written of [DE, '+49 151 2345 6789', '+49 (151) 234-56789', '＋４９１５１２３４５６７８９', '+٤٩١٥١٢٣٤٥٦٧٨٩']) {
      const out = redactPhones(`The 'To' number ${written} is not valid`);
      expect(out).not.toContain(written);
      expect(out).not.toMatch(/23456789|٢٣٤٥٦٧٨٩|２３４５６７８９/u);
      expect(out).toContain("The 'To' number ");
    }
  });

  it('masks a known number in the forms written without a plus', () => {
    const out = redactPhones('to=4915123456789 dialled=004915123456789 local=015123456789 shown=0151 23456789 grouped=01512 3456789', [DE], 'DE');
    expect(out).not.toMatch(/3456789/);
    expect(out).toContain('to=+49 ••• 789');
  });

  it('masks a number in a URL-encoded query, and a known value holding regex characters', () => {
    expect(redactPhones(`POST /Messages?To=%2B4915123456789&From=x`)).toBe('POST /Messages?To=+49 ••• 789&From=x');
    expect(redactPhones('rang (030) 1234-x today', ['(030) 1234-x'])).toBe('rang ••• today');
  });

  it('leaves ids, timestamps and short counts alone', () => {
    const text = 'job 1763726400000 failed after 3 tries, code 21610';
    expect(redactPhones(text)).toBe(text);
  });

  it('removes a known value that cannot be read as a number', () => {
    expect(redactPhones('sent to 0151-BAD-NUM', ['0151-BAD-NUM'])).toBe('sent to •••');
  });
});

describe('the hash subject', () => {
  it('is tel: and the E.164 form, with one plus', () => {
    expect(textSubject(DE)).toBe(`tel:${DE}`);
    expect(textSubject(DE)).not.toContain('++');
  });

  it.each([['4915123456789'], ['++4915123456789'], ['tel:+4915123456789'], ['+49 151 23456789'], ['']])('refuses %j', (value) => {
    expect(() => textSubject(value)).toThrow(/exact phone number/);
  });
});

describe('no text path asks the e-mail stop list', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

  it('never calls stoppedAmong or stop.has of the e-mail door from sms/', () => {
    const root = join(import.meta.dirname, '../src/sms');
    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\.stoppedAmong\(/);
      expect(text, file).not.toMatch(/createConsentService/);
    }
  });
});

describe.each(META_ENGINES)('text consent — $name', (engine) => {
  let handle: MetaHandle;
  let service: TextConsentService;
  let clock = 1_000;
  const tick = () => (clock += 1);
  const yes = (phone: unknown, purpose: 'text-service' | 'text-marketing' = 'text-service', more: Record<string, unknown> = {}) =>
    service.record({ phone, purpose, state: 'yes', source: 'form', detail: 'Booking form', wording: purpose === 'text-service' ? wording : marketingWords, ...more });

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
    for (const table of ['adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_stop_list', 'adminium_consent_log', 'adminium_address_keys']) await db.deleteFrom(table).execute();
    clock = 1_000;
    service = createTextConsentService({ meta: handle.meta, secret: SECRET, now: tick });
  });

  describe('consent', () => {
    it.runIf(engine.available)('refuses with no answer, and sends after an explicit yes', async () => {
      expect(refusal(await service.decide(serviceFrom(DE)))).toBe('no-consent');
      await yes(DE);
      expect(await service.decide(serviceFrom(DE))).toEqual({ send: true, e164: DE, country: 'DE', optOut: 'reply-stop' });
    });

    it.runIf(engine.available)('keeps the two purposes apart in both directions', async () => {
      await yes(GB, 'text-service');
      expect((await service.decide(serviceFrom(GB))).send).toBe(true);
      expect(refusal(await service.decide(marketingFrom(GB)))).toBe('no-consent');

      await yes(US, 'text-marketing');
      expect((await service.decide(marketingFrom(US))).send).toBe(true);
      expect(refusal(await service.decide(serviceFrom(US)))).toBe('no-consent');
    });

    it.runIf(engine.available)('is not unlocked by an e-mail yes on the same row, or by a yes to the newsletter', async () => {
      const mail = createConsentService({ meta: handle.meta, secret: SECRET, now: tick });
      await mail.record({ person: marta, address: 'marta@example.test', purpose: 'newsletter', state: 'yes', source: 'form', wording: { text: 'News', version: '1' } });
      await mail.record({ person: marta, purpose: 'surveys', state: 'yes', source: 'form' });
      expect(refusal(await service.decide(serviceFrom(GB, { person: marta })))).toBe('no-consent');
      expect(refusal(await service.decide(marketingFrom(GB, { person: marta })))).toBe('no-consent');
    });

    it.runIf(engine.available)('reads a phone through the e-mail door as not stopped, which is why no text path asks it', async () => {
      const mail = createConsentService({ meta: handle.meta, secret: SECRET, now: tick });
      await service.stop.add({ phone: DE, reason: 'text-stop' });
      expect([...(await mail.stop.stoppedAmong([DE]))]).toEqual([]);
      expect(await service.stop.has(DE, null)).toBe(true);
      expect(refusal(await service.decide(serviceFrom(DE)))).toBe('stopped');
    });

    it.runIf(engine.available)('keeps a phone off the do-not-email list and an e-mail stop off the text list', async () => {
      const mail = createConsentService({ meta: handle.meta, secret: SECRET, now: tick });
      await service.stop.add({ phone: DE, reason: 'text-stop' });
      await mail.stop.add({ address: 'marta@example.test', reason: 'link' });
      expect(await mail.stop.count()).toBe(1);
      expect((await service.stop.list({ limit: 10 })).entries).toHaveLength(1);
    });

    it.runIf(engine.available)('does not follow a row to a new number', async () => {
      await yes(DE, 'text-service', { person: marta });
      expect((await service.decide(serviceFrom(DE, { person: marta }))).send).toBe(true);
      expect(refusal(await service.decide(serviceFrom(DE_OTHER, { person: marta })))).toBe('no-consent');
    });

    it.runIf(engine.available)('reads a local number and its international form as one number', async () => {
      await yes('0151 23456789', 'text-service', { country: 'DE' });
      expect((await service.decide(serviceFrom(DE))).send).toBe(true);
      expect((await service.decide(serviceFrom('+49 151 23456789'))).send).toBe(true);
      expect((await service.decide(serviceFrom('015123456789', { country: 'DE' }))).send).toBe(true);
    });

    it.runIf(engine.available)('never matches a near number', async () => {
      await yes(DE);
      await service.stop.add({ phone: GB, reason: 'text-stop' });
      expect(refusal(await service.decide(serviceFrom(DE_OTHER)))).toBe('no-consent');
      expect(await service.stop.has('+447400123457', null)).toBe(false);
      await service.stop.add({ phone: DE, reason: 'text-stop' });
      expect(parsePhone(FUZZY_TWIN, null).ok).toBe(true);
      expect(await service.stop.has(FUZZY_TWIN, null)).toBe(false);
    });

    it.runIf(engine.available)('lets the latest answer stand, and a no at the same moment beats a yes', async () => {
      await yes(DE, 'text-service', { at: 5_000 });
      await service.record({ phone: DE, purpose: 'text-service', state: 'no', source: 'person', at: 5_000 });
      expect(refusal(await service.decide(serviceFrom(DE)))).toBe('no-consent');
      await yes(DE, 'text-service', { at: 6_000 });
      expect((await service.decide(serviceFrom(DE))).send).toBe(true);
    });

    it.runIf(engine.available)('lets a no beat a yes written after it at the same moment', async () => {
      await service.record({ phone: DE, purpose: 'text-service', state: 'no', source: 'person', at: 5_000 });
      await yes(DE, 'text-service', { at: 5_000 });
      expect(refusal(await service.decide(serviceFrom(DE)))).toBe('no-consent');
    });

    it.runIf(engine.available)('lets a no on the row beat a yes on the number at the same moment', async () => {
      await service.record({ person: marta, purpose: 'text-service', state: 'no', source: 'staff', staff: dana, at: 3_000 });
      await yes(DE, 'text-service', { person: marta, at: 3_000 });
      expect(refusal(await service.decide(serviceFrom(DE, { person: marta })))).toBe('no-consent');
    });

    it.runIf(engine.available)('lets a later no on the row cover every number the row has', async () => {
      await yes(DE, 'text-service', { person: marta, at: 2_000 });
      await service.record({ person: marta, purpose: 'text-service', state: 'no', source: 'staff', staff: dana, at: 3_000 });
      expect(refusal(await service.decide(serviceFrom(DE, { person: marta })))).toBe('no-consent');
      await yes(DE, 'text-service', { person: marta, at: 4_000 });
      expect((await service.decide(serviceFrom(DE, { person: marta }))).send).toBe(true);
    });

    it.runIf(engine.available)('keeps the wording, version and source of a yes', async () => {
      await yes(DE, 'text-service', { ip: '203.0.113.9', userAgent: 'Firefox' });
      const { event, state } = await service.standing({ phone: DE }, 'text-service');
      expect(state).toBe('yes');
      expect(event).toMatchObject({ wording: wording.text, wordingVersion: 'v3', source: 'form', detail: 'Booking form', ip: '203.0.113.9', userAgent: 'Firefox' });
    });

    it.runIf(engine.available)('refuses a yes with no wording, from a door that cannot give one, or for a number it cannot read', async () => {
      await expect(service.record({ phone: DE, purpose: 'text-service', state: 'yes', source: 'form' })).rejects.toThrow(/words the person was shown/);
      await expect(service.record({ phone: DE, purpose: 'text-service', state: 'yes', source: 'form', wording: { text: ' ', version: 'v1' } })).rejects.toThrow(/words/);
      await expect(service.record({ phone: DE, purpose: 'text-service', state: 'yes', source: 'person', wording })).rejects.toThrow(/form or a staff/);
      await expect(service.record({ phone: DE, purpose: 'text-service', state: 'yes', source: 'staff', wording })).rejects.toThrow(/staff member/);
      await expect(service.record({ phone: DE, purpose: 'text-service', state: 'yes', source: 'reply' as 'form', wording })).rejects.toThrow(/source/);
      await expect(service.record({ phone: DE, purpose: 'newsletter' as 'text-service', state: 'yes', source: 'form', wording })).rejects.toThrow(/purpose/);
      await expect(service.record({ phone: 'garbage', purpose: 'text-service', state: 'yes', source: 'form', wording, person: marta })).rejects.toThrow(/phone number/);
      await expect(service.record({ person: marta, purpose: 'text-service', state: 'yes', source: 'form', wording })).rejects.toThrow(/phone number/);
    });

    it.runIf(engine.available)('still lands a no on the row when the number cannot be read', async () => {
      const event = await service.record({ phone: 'garbage', person: marta, purpose: 'text-service', state: 'no', source: 'person' });
      expect(event.phone).toBeNull();
      expect(event.person).toEqual(marta);
      await expect(service.record({ phone: 'garbage', purpose: 'text-service', state: 'no', source: 'person' })).rejects.toThrow(/phone number/);
    });

    it.runIf(engine.available)('needs a confirmed yes for marketing to Germany, and not for service or elsewhere', async () => {
      await yes(DE, 'text-marketing');
      await yes(DE, 'text-service');
      await yes(GB, 'text-marketing');
      expect(refusal(await service.decide(marketingFrom(DE)))).toBe('unconfirmed-consent');
      expect((await service.decide(serviceFrom(DE))).send).toBe(true);
      expect((await service.decide(marketingFrom(GB))).send).toBe(true);
      await yes(DE, 'text-marketing', { confirmedAt: 9_000 });
      expect((await service.decide(marketingFrom(DE))).send).toBe(true);
    });

    it.runIf(engine.available)('states the opt-out that works for the sender and the country', async () => {
      await yes(GB);
      await yes(AE);
      const optOut = async (request: TextRequest) => {
        const decision = await service.decide(request);
        return decision.send ? decision.optOut : decision.reason;
      };
      expect(await optOut(serviceFrom(GB))).toBe('reply-stop');
      expect(await optOut(serviceFrom(GB, { sender: { kind: 'name' } }))).toBe('through-business');
      expect(await optOut(serviceFrom(GB, { repliesReachUs: false }))).toBe('through-business');
      expect(await optOut(serviceFrom(AE))).toBe('through-business');
    });
  });

  describe('STOP and START', () => {
    it.runIf(engine.available)('STOP stops service and marketing, from every kind of sender', async () => {
      await yes(GB, 'text-service');
      await yes(GB, 'text-marketing');
      await service.stop.add({ phone: GB, reason: 'text-stop', origin: 'twilio' });
      for (const request of [serviceFrom(GB), marketingFrom(GB), serviceFrom(GB, { sender: { kind: 'name' } }), serviceFrom('07400 123456', { country: 'GB' })]) {
        expect(refusal(await service.decide(request))).toBe('stopped');
      }
    });

    it.runIf(engine.available)('keeps one entry through repeated STOPs, and for a number written differently', async () => {
      expect((await service.stop.add({ phone: DE, reason: 'text-stop' })).added).toBe(true);
      expect((await service.stop.add({ phone: DE, reason: 'provider-opt-out' })).added).toBe(false);
      expect((await service.stop.add({ phone: '0151 23456789', country: 'DE', reason: 'staff', staff: dana })).added).toBe(false);
      expect((await service.stop.list({ limit: 10 })).entries).toHaveLength(1);
    });

    it.runIf(engine.available)('keeps one entry when many STOPs land at once', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => service.stop.add({ phone: DE, reason: 'text-stop' })));
      expect(results.filter((one) => one.added)).toHaveLength(1);
      expect((await service.stop.list({ limit: 10 })).entries).toHaveLength(1);
    }, 30_000);

    it.runIf(engine.available)('keeps a STOP that crosses a START', async () => {
      await service.stop.add({ phone: DE, reason: 'text-stop' });
      const racing = createTextConsentService({
        meta: handle.meta,
        secret: SECRET,
        now: tick,
        store: (() => {
          const real = createTextConsentStore(handle.meta);
          // The START lands after this STOP read the entry and before it wrote.
          return { ...real, transaction: async (work) => { await service.stop.start({ phone: DE }); return real.transaction(work); } } as TextConsentStore;
        })(),
      });
      await racing.stop.add({ phone: DE, reason: 'text-stop' });
      expect(await service.stop.has(DE, null)).toBe(true);
    });

    it.runIf(engine.available)('refuses a row named by an empty or over-long key', async () => {
      for (const key of ['', 'k'.repeat(201)]) {
        await expect(service.record({ person: { ...marta, key }, phone: DE, purpose: 'text-service', state: 'no', source: 'person' })).rejects.toThrow(/1 to 200/);
      }
    });

    it.runIf(engine.available)('a new yes does not lift a STOP', async () => {
      await service.stop.add({ phone: DE, reason: 'text-stop' });
      await yes(DE);
      expect(refusal(await service.decide(serviceFrom(DE)))).toBe('stopped');
    });

    it.runIf(engine.available)('START lifts the block and does not mean yes, even after an earlier yes', async () => {
      await yes(GB, 'text-service', { at: 500 });
      await yes(GB, 'text-marketing', { at: 500 });
      await service.stop.add({ phone: GB, reason: 'text-stop' });
      expect(await service.stop.start({ phone: GB })).toBe('lifted');
      expect(await service.stop.has(GB, null)).toBe(false);
      expect(refusal(await service.decide(serviceFrom(GB)))).toBe('no-consent');
      expect(refusal(await service.decide(marketingFrom(GB)))).toBe('no-consent');

      await yes(GB, 'text-service');
      expect((await service.decide(serviceFrom(GB))).send).toBe(true);
      expect(refusal(await service.decide(marketingFrom(GB)))).toBe('no-consent');
    });

    it.runIf(engine.available)('records a START as neither a yes nor a no', async () => {
      await service.stop.add({ phone: GB, reason: 'text-stop' });
      await service.stop.start({ phone: GB });
      const history = await service.history({ phone: GB });
      expect(history.filter((one) => one.state === 'start')).toHaveLength(1);
      expect(history.filter((one) => one.state === 'yes')).toHaveLength(0);
      expect((await service.standing({ phone: GB }, 'text-service')).state).toBe('no');
    });

    it.runIf(engine.available)('a START does not lift what staff recorded or an erased entry', async () => {
      await service.stop.add({ phone: GB, reason: 'staff', staff: dana });
      expect(await service.stop.start({ phone: GB })).toBe('kept');
      expect(await service.stop.has(GB, null)).toBe(true);
      await service.erase({ phone: DE });
      expect(await service.stop.start({ phone: DE })).toBe('kept');
      expect(await service.stop.has(DE, null)).toBe(true);
    });

    it.runIf(engine.available)('answers a START from a number not on the list, or one it cannot read', async () => {
      expect(await service.stop.start({ phone: GB })).toBe('not-on-list');
      expect(await service.stop.start({ phone: 'garbage' })).toBe('unreadable');
    });

    it.runIf(engine.available)('takes a real STOP from a range the phone library does not know', async () => {
      expect(parsePhone(UNKNOWN_RANGE, null).ok).toBe(false);
      expect((await service.stop.add({ phone: UNKNOWN_RANGE, reason: 'text-stop' })).added).toBe(true);
      expect(await service.stop.has(UNKNOWN_RANGE, null)).toBe(true);
    });

    it.runIf(engine.available)('refuses a stop for anything else, and an erased entry from any door but the erasure', async () => {
      await expect(service.stop.add({ phone: 'garbage', reason: 'text-stop' })).rejects.toThrow(/phone number/);
      await expect(service.stop.add({ phone: DE, reason: 'erased' as 'staff', staff: dana })).rejects.toThrow(/erasure/);
      await expect(service.stop.add({ phone: DE, reason: 'staff' })).rejects.toThrow(/staff member/);
    });

    it.runIf(engine.available)('answers true for a value it cannot read', async () => {
      for (const value of ['garbage', '', null, undefined, 12345, {}]) expect(await service.stop.has(value, 'DE')).toBe(true);
    });

    it.runIf(engine.available)('staff taking an entry off does not restore consent', async () => {
      await yes(GB);
      const { entry } = await service.stop.add({ phone: GB, reason: 'text-stop' });
      expect(await service.stop.remove(entry.id)).toBe('removed');
      expect(refusal(await service.decide(serviceFrom(GB)))).toBe('no-consent');
      expect(await service.stop.remove(entry.id)).toBe('missing');
    });

    it.runIf(engine.available)('pages the list, newest first', async () => {
      for (const phone of [DE, GB, US]) await service.stop.add({ phone, reason: 'text-stop' });
      const first = await service.stop.list({ limit: 2 });
      expect(first.entries.map((one) => one.phone)).toEqual([US, GB]);
      expect(first.entries[0]!.masked).toBe('+1 ••• 123');
      const second = await service.stop.list({ limit: 2, cursor: first.next });
      expect(second.entries.map((one) => one.phone)).toEqual([DE]);
      expect(second.next).toBeNull();
      await expect(service.stop.list({ limit: 2, cursor: 'nonsense' })).rejects.toThrow(/cursor/);
    });
  });

  describe('a person known only by phone, and their erasure', () => {
    it.runIf(engine.available)('works with no e-mail and no row', async () => {
      await yes(DE);
      expect((await service.decide(serviceFrom(DE))).send).toBe(true);
      expect(await service.history({ phone: DE })).toHaveLength(1);
    });

    it.runIf(engine.available)('an erasure of one row leaves a row whose key differs only by case', async () => {
      const lower = { connectionId: 'con_case', table: 'public.people', key: 'abc' };
      const upper = { ...lower, key: 'ABC' };
      await service.record({ person: lower, phone: DE, purpose: 'text-service', state: 'no', source: 'person', at: 1_000 });
      await service.record({ person: upper, phone: '+4915123456780', purpose: 'text-service', state: 'no', source: 'person', at: 1_000 });
      expect((await service.erase({ person: lower })).consentRows).toBe(1);
      expect(await service.history({ person: lower })).toHaveLength(0);
      expect((await service.history({ person: upper })).map((one) => one.person?.key)).toEqual(['ABC']);
    });

    it.runIf(engine.available)('erases their events, keeps a hash-only entry, and still refuses', async () => {
      await yes(DE);
      await service.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio' });
      expect(await service.erase({ phone: DE, at: 9_000 })).toEqual({ stopList: 'erased', consentRows: 3 });
      const entry = await service.stop.entryFor(DE, null);
      expect(entry).toMatchObject({ phone: null, masked: null, erasedAt: 9_000 });
      expect(await service.history({ phone: DE })).toEqual([]);
      expect(refusal(await service.decide(serviceFrom(DE)))).toBe('stopped');
      expect(await service.stop.remove(entry!.id)).toBe('erased');
      expect(await service.stop.has(DE, null)).toBe(true);
    });

    it.runIf(engine.available)('puts an erased number on the list when it was not there, by its hash alone', async () => {
      await yes(GB);
      expect(await service.erase({ phone: GB })).toEqual({ stopList: 'added', consentRows: 1 });
      const entry = await service.stop.entryFor(GB, null);
      expect(entry).toMatchObject({ reason: 'erased', phone: null });
      expect(refusal(await service.decide(serviceFrom(GB)))).toBe('stopped');
    });

    it.runIf(engine.available)('erases a row by its key, with its events under any number', async () => {
      await yes(DE, 'text-service', { person: marta });
      await yes(GB, 'text-service', { person: marta });
      expect((await service.erase({ phone: DE, person: marta })).consentRows).toBe(2);
      expect(await service.history({ person: marta })).toEqual([]);
    });

    it.runIf(engine.available)('still erases the row\'s events when the number on it cannot be read', async () => {
      await service.record({ person: marta, purpose: 'text-service', state: 'no', source: 'person' });
      expect(await service.erase({ phone: 'garbage', person: marta })).toEqual({ stopList: 'unreadable', consentRows: 1 });
      expect(await service.erase({ person: marta })).toEqual({ stopList: 'none', consentRows: 0 });
    });

    it.runIf(engine.available)('on a shared line, erasing one person leaves another person\'s yes, with its words, and takes the rows that name nobody', async () => {
      const daughter = { connectionId: 'con_1', table: 'public.people', key: 'daughter-7' };
      await yes(DE, 'text-service', { person: marta });
      await yes(DE, 'text-service', { person: daughter, wording: { text: 'Text me about my lessons', version: 'd1' } });
      await service.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio' });
      // Marta's own yes, and the two noes the STOP wrote for the number alone.
      expect((await service.erase({ phone: DE, person: marta })).consentRows).toBe(3);
      const left = await service.history({ phone: DE });
      expect(left.map((one) => [one.person?.key, one.state, one.wording])).toEqual([['daughter-7', 'yes', 'Text me about my lessons']]);
    });

    it.runIf(engine.available)('the Super Admin\'s lift takes an erased entry off with a fresh named yes, for the number typed again', async () => {
      await yes(DE);
      await service.erase({ phone: DE, at: 9_000 });
      const entry = (await service.stop.entryFor(DE, null))!;
      const lift = { id: entry.id, purpose: 'text-service' as const, wording: { text: 'Text me about my lessons', version: 'd2' }, how: 'in-person' as const, staff: { id: 'usr_owner', label: 'Owner' }, at: 10_000 };
      expect(await service.stop.liftErased({ ...lift, phone: GB })).toBe('other-number');
      expect(await service.stop.has(DE, null)).toBe(true);
      expect(await service.stop.liftErased({ ...lift, phone: DE })).toBe('lifted');
      expect(await service.stop.has(DE, null)).toBe(false);
      // The fresh yes is what sends now, in its own words and under the staff member's name.
      expect(await service.standing({ phone: DE }, 'text-service')).toMatchObject({ state: 'yes', event: { wording: 'Text me about my lessons', staffLabel: 'Owner', source: 'staff' } });
      expect(await service.stop.liftErased({ ...lift, phone: DE })).toBe('missing');
      // An ordinary entry is not this route's: it has its number, and Remove.
      await service.stop.add({ phone: GB, reason: 'text-stop', origin: 'twilio' });
      expect(await service.stop.liftErased({ ...lift, id: (await service.stop.entryFor(GB, null))!.id, phone: GB })).toBe('not-erased');
    });

    it.runIf(engine.available)('leaves another person alone', async () => {
      await yes(DE);
      await yes(GB);
      await service.erase({ phone: DE });
      expect((await service.decide(serviceFrom(GB))).send).toBe(true);
    });

    it.runIf(engine.available)('finds their rows by the exact number, however each was typed, and never a near one', async () => {
      const db = handle.meta.db as unknown as Kysely<SourceDatabase>;
      await sql`drop table if exists sms_people`.execute(db);
      await sql`create table sms_people (id integer primary key, region integer not null, mobile varchar(64))`.execute(db);
      const values: [number, number, string | null][] = [
        [1, 1, DE],
        [2, 1, '0151 23456789'],
        [3, 2, '+49 (151) 234-56789'],
        [4, 2, DE_OTHER],
        [5, 2, '15123456789'],
        [6, 3, null],
        [7, 3, 'not a phone'],
        // Ends in the German number's digits: the erasure's fuzzy `samePhone` would call this the same number.
        [8, 3, FUZZY_TWIN],
      ];
      for (const [id, region, mobile] of values) await sql`insert into sms_people (id, region, mobile) values (${id}, ${region}, ${mobile})`.execute(db);
      try {
        const found = await findRowsByPhone({ db, table: { id: 'sms_people', primaryKey: ['id'] }, column: 'mobile', e164: DE, country: 'DE' });
        expect(found.map((row) => Number(row['id'])).sort()).toEqual([1, 2, 3, 5]);
        const composite = await findRowsByPhone({ db, table: { id: 'sms_people', primaryKey: ['region', 'id'] }, column: 'mobile', e164: DE, country: 'DE' });
        expect(composite.map((row) => Number(row['id'])).sort()).toEqual([1, 2, 3, 5]);
        expect(await findRowsByPhone({ db, table: { id: 'sms_people', primaryKey: [] }, column: 'mobile', e164: DE, country: 'DE' })).toEqual([]);
      } finally {
        await sql`drop table sms_people`.execute(db);
      }
    });

    it.runIf(engine.available)('walks past a full batch', async () => {
      const db = handle.meta.db as unknown as Kysely<SourceDatabase>;
      await sql`drop table if exists sms_many`.execute(db);
      await sql`create table sms_many (id integer primary key, mobile varchar(64))`.execute(db);
      try {
        for (let start = 1; start <= 1100; start += 100) {
          const part = Array.from({ length: 100 }, (_, i) => sql`(${start + i}, ${start + i === 1050 ? DE : GB})`);
          await sql`insert into sms_many (id, mobile) values ${sql.join(part)}`.execute(db);
        }
        const found = await findRowsByPhone({ db, table: { id: 'sms_many', primaryKey: ['id'] }, column: 'mobile', e164: DE, country: null });
        expect(found.map((row) => Number(row['id']))).toEqual([1050]);
      } finally {
        await sql`drop table sms_many`.execute(db);
      }
    }, 30_000);
  });

  describe('what is kept', () => {
    it.runIf(engine.available)('keeps no number in clear in either table', async () => {
      await yes(DE, 'text-service', { person: marta, detail: `form for ${DE}` });
      await service.stop.add({ phone: DE, reason: 'staff', staff: dana, origin: `call from ${DE}` });
      await service.record({ phone: DE, purpose: 'text-marketing', state: 'no', source: 'staff', staff: dana, note: `rang from +49 151 2345 6789` });
      const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
      const stored = JSON.stringify([await db.selectFrom('adminium_text_stop_list').selectAll().execute(), await db.selectFrom('adminium_text_consent_log').selectAll().execute()]);
      expect(stored).not.toContain('23456789');
      expect(stored).not.toContain('2345 6789');
      expect(stored).toContain('+49 ••• 789');
    });

    it.runIf(engine.available)('hashes the number as tel:+E.164 under the address key, apart from any e-mail', async () => {
      const event = await yes(DE);
      const row = (await addressKeysRepo(handle.meta).all())[0]!;
      const key = Buffer.from(decryptSecret(row.keyEncrypted, addressKeysWrapKey(SECRET)), 'base64');
      expect(event.phone).toEqual({ hash: createHmac('sha256', key).update(`tel:${DE}`).digest('hex'), version: row.version });
      expect(event.phone!.hash).not.toBe(createHmac('sha256', key).update(`tel:+${DE}`).digest('hex'));
      expect(event.phone!.hash).not.toBe(createHmac('sha256', key).update(DE).digest('hex'));
    });

    it.runIf(engine.available)('never puts the number in an error', async () => {
      const secretish = '+49 151 BAD 6789';
      for (const attempt of [
        () => service.record({ phone: secretish, purpose: 'text-service', state: 'yes', source: 'form', wording }),
        () => service.stop.add({ phone: secretish, reason: 'text-stop' }),
      ]) {
        const error: unknown = await attempt().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect(JSON.stringify([(error as Error).message, (error as { details?: unknown }).details])).not.toContain('6789');
      }
    });
  });

  describe('fails closed', () => {
    it.runIf(engine.available)('throws rather than answers when the keys cannot be read', async () => {
      await yes(GB);
      const locked = createTextConsentService({ meta: handle.meta, secret: NEXT, now: tick });
      await expect(locked.decide(serviceFrom(GB))).rejects.toBeInstanceOf(AddressKeysLockedError);
      await expect(locked.stop.has(GB, null)).rejects.toBeInstanceOf(AddressKeysLockedError);
    });

    it.runIf(engine.available)('throws rather than answers when the store fails', async () => {
      await yes(GB);
      const real = createTextConsentService({ meta: handle.meta, secret: SECRET, now: tick });
      const broken = createTextConsentService({
        meta: handle.meta,
        secret: SECRET,
        store: {
          stop: { findAny: () => Promise.reject(new Error('down')) },
          log: {},
          transaction: () => Promise.reject(new Error('down')),
        } as never,
      });
      expect((await real.decide(serviceFrom(GB))).send).toBe(true);
      await expect(broken.decide(serviceFrom(GB))).rejects.toThrow('down');
    });

    it.runIf(engine.available)('keeps every entry matching and readable through a changed secret and a new key version', async () => {
      await service.stop.add({ phone: DE, reason: 'text-stop' });
      await service.stop.add({ phone: GB, reason: 'text-stop' });
      await service.erase({ phone: GB });
      await resealUnderNewSecret(handle.meta, { from: SECRET, to: NEXT });
      const moved = createTextConsentService({ meta: handle.meta, secret: NEXT, now: tick });
      expect(await moved.stop.has(DE, null)).toBe(true);
      expect(await moved.stop.has(GB, null)).toBe(true);
      expect((await moved.stop.entryFor(DE, null))?.phone).toBe(DE);

      await renewAddressKey(handle.meta, NEXT);
      expect(await moved.stop.has(DE, null)).toBe(true);
      expect(await moved.stop.has(GB, null)).toBe(true);
      expect((await moved.stop.entryFor(DE, null))?.phone).toBe(DE);
      expect((await moved.stop.add({ phone: DE, reason: 'staff', staff: dana })).added).toBe(false);
    });
  });
});

describe.each(META_ENGINES)('when the tables cannot be read — $name', (engine) => {
  let handle: MetaHandle;
  beforeAll(async () => {
    if (engine.available) handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });

  it.runIf(engine.available)('throws rather than lets a text through', async () => {
    const service = createTextConsentService({ meta: handle.meta, secret: SECRET });
    // A key exists, so the lookup reaches the store.
    await createConsentService({ meta: handle.meta, secret: SECRET }).stop.add({ address: 'a@example.test', reason: 'link' });
    await sql`drop table adminium_text_stop_list`.execute(handle.meta.db);
    await expect(service.decide(serviceFrom(DE))).rejects.toThrow(/adminium_text_stop_list/);
  });
});
