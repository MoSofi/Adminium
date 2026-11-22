// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What each provider's answer means. Every reply here is a stub written from
 * the provider's documentation: these tests prove this layer's reading of the
 * documented shapes, and CANNOT prove the live APIs still answer that way.
 *
 * The rule under test: a send is accepted, certainly not taken, refused, or
 * unknown, and nothing that might have gone is ever reported as safe to retry.
 */
import { describe, expect, it } from 'vitest';

import { afterAttempt, createSmsService, TELNYX_CODES, TWILIO_CODES, type SmsCredentialInput, type SmsService, type SmsServiceResult } from '../src/sms/index.js';
import { describeSmsStoreContract, memorySmsStore } from './helpers/sms-store.js';

const SECRET = 'an-sms-provider-test-secret-of-length';
// Built at run time, so no provider-shaped value sits in the source.
const SID = `AC${'ab'.repeat(16)}`;
const TOKEN = 'made-up-token-for-these-tests';
const API_KEY = 'made-up-telnyx-key-for-tests';
const PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const PROFILE = '11111111-2222-4333-8444-555555555555';
const TO = '+14155552671';
const FROM = '+14155550100';
const BODY = 'Your table is ready at the Lumen';
const KEY = 'message-key-1';

const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: SID, authToken: TOKEN };
const TELNYX: SmsCredentialInput = { provider: 'telnyx', apiKey: API_KEY, publicKey: PUBLIC_KEY, messagingProfileId: PROFILE };

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  redirect: RequestRedirect | undefined;
}

type Answer = Response | Error | 'hang';

const json = (status: number, value: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

const networkError = (code: string): Error => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) });

const twilioAccount = (over: Record<string, unknown> = {}) => json(200, { sid: SID, friendly_name: 'owner@lumen.example', status: 'active', type: 'Full', auth_token: TOKEN, ...over });
const telnyxProfile = (over: Record<string, unknown> = {}) => json(200, { data: { record_type: 'messaging_profile', id: PROFILE, name: 'Lumen Bistro', enabled: true, ...over } });
const twilioError = (status: number, code: number) => json(status, { status, code, message: `Number ${TO} said: ${BODY}`, more_info: 'https://www.twilio.com/docs/errors' });
const telnyxError = (status: number, ...codes: string[]) => json(status, { errors: codes.map((code) => ({ code, title: 'Provider words', detail: `${TO}: ${BODY}` })) });
const twilioSent = () => json(201, { sid: `SM${'cd'.repeat(16)}`, status: 'queued', num_segments: '2', price: '-0.0083', price_unit: 'USD', to: TO, from: FROM, body: BODY, error_code: null });
const telnyxSent = (headers: Record<string, string> = {}) =>
  json(200, { data: { record_type: 'message', id: '40000000-0000-4000-8000-000000000001', to: [{ phone_number: TO, status: 'queued' }], text: BODY, parts: 1, cost: { amount: '0.0051', currency: 'USD' }, errors: [] } }, headers);

/** A connected service whose provider answers from `answers`, one per send. */
async function connected(input: SmsCredentialInput, answers: Answer[] = [], clock: { now: number } = { now: 1_000_000 }, numberProfile?: string) {
  const seen: Seen[] = [];
  const queue: Answer[] = [input.provider === 'twilio' ? twilioAccount() : telnyxProfile(), ...answers];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : '', redirect: init?.redirect });
    // Which profile a number is on: not one of the scripted answers.
    if (String(url).includes('/phone_numbers/messaging')) return json(200, { data: numberProfile === undefined ? [] : [{ phone_number: FROM, messaging_profile_id: numberProfile }] });
    const next = queue.shift();
    if (next === undefined) throw new Error('The stub has no answer left.');
    if (next === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const store = memorySmsStore();
  const service = createSmsService({ store, secret: SECRET, fetch: fetchStub, now: () => clock.now, timeoutMs: 25, stopList: { isStopped: async () => false, recordProviderOptOut: async () => undefined } });
  await service.connect(input, 'person-1');
  await service.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'US' }, 'person-1');
  seen.length = 0;
  return { service, seen, store, queue };
}

const sendOn = (service: SmsService, over: Partial<Parameters<SmsService['send']>[0]> = {}): Promise<SmsServiceResult> =>
  service.send({ to: TO, body: BODY, idempotencyKey: KEY, ...over });

describeSmsStoreContract('in memory', async () => memorySmsStore());

describe('Twilio: sending', () => {
  it('posts the documented form with Basic auth and reads the reply', async () => {
    const { service, seen } = await connected(TWILIO, [twilioSent()]);
    const result = await sendOn(service, { callbackUrl: 'https://crm.lumen.example/hook' });
    expect(result).toMatchObject({ outcome: 'accepted', provider: 'twilio', status: 'queued', segments: 2, price: { amount: '-0.0083', currency: 'USD' }, replayed: false, to: TO });
    const call = seen[0]!;
    expect(call.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(call.method).toBe('POST');
    expect(call.headers.get('authorization')).toBe(`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`);
    expect(call.headers.get('idempotency-key')).toBeNull();
    expect(call.redirect).toBe('manual');
    const form = new URLSearchParams(call.body);
    expect(Object.fromEntries(form)).toEqual({ To: TO, Body: BODY, From: FROM, StatusCallback: 'https://crm.lumen.example/hook' });
  });

  it('sends a Messaging Service as its SID, and a name as From', async () => {
    const service = `MG${'ef'.repeat(16)}`;
    const pool = await connected(TWILIO, [twilioSent()]);
    await sendOn(pool.service, { sender: { kind: 'pool', value: service } });
    const form = new URLSearchParams(pool.seen[0]!.body);
    expect(form.get('MessagingServiceSid')).toBe(service);
    expect(form.get('From')).toBeNull();
    const named = await connected(TWILIO, [twilioSent()]);
    await sendOn(named.service, { sender: { kind: 'name', value: 'Lumen' } });
    expect(new URLSearchParams(named.seen[0]!.body).get('From')).toBe('Lumen');
  });

  it.each([
    [21211, 'invalid-number'],
    [21212, 'invalid-sender'],
    [21408, 'country-not-enabled'],
    [21606, 'sender-cannot-text'],
    [21610, 'opted-out'],
    [21612, 'unreachable'],
    [21614, 'not-mobile'],
    [21617, 'body-too-long'],
  ])('reads error %i as refused: %s', async (code, reason) => {
    const { service } = await connected(TWILIO, [twilioError(400, code)]);
    const result = await sendOn(service);
    expect(result).toMatchObject({ outcome: 'refused', reason, providerCode: String(code), to: TO });
    expect(JSON.stringify(result)).not.toContain(BODY);
  });

  it('reads a full sender queue (21611) as certainly not taken', async () => {
    const { service } = await connected(TWILIO, [twilioError(400, 21611)]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'not-taken', reason: 'queue-full', providerCode: '21611' });
  });

  it('reads a 429 as not taken, with its Retry-After', async () => {
    const { service } = await connected(TWILIO, [json(429, { status: 429, code: 20429, message: 'Too many' }, { 'retry-after': '7' })]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'not-taken', reason: 'rate-limited', retryAfterMs: 7000 });
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED'])('reads %s as certainly not taken', async (code) => {
    const { service } = await connected(TWILIO, [networkError(code)]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'not-taken', reason: 'no-connection' });
  });

  it.each(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'SOME_NEW_CODE'])('never retries after %s: unknown, check first', async (code) => {
    const { service } = await connected(TWILIO, [networkError(code)]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'connection-lost', resend: 'check-first' });
  });

  it('never retries after a timeout', async () => {
    const { service } = await connected(TWILIO, ['hang']);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'timeout', resend: 'check-first' });
  });

  it.each([500, 502, 503, 504, 302, 408, 418])('reads a %i as unknown', async (status) => {
    const { service } = await connected(TWILIO, [new Response('nope', { status })]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'server-error', resend: 'check-first' });
  });

  it('reads a success with no readable id as unknown, never accepted', async () => {
    for (const reply of [new Response('not json', { status: 201 }), json(201, { status: 'queued' }), json(201, { sid: 'has spaces in it' })]) {
      const { service } = await connected(TWILIO, [reply]);
      expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'unreadable-reply', resend: 'check-first' });
    }
  });

  it('reads a refused key as refused, and an unknown 400 as a plain refusal', async () => {
    const bad = await connected(TWILIO, [twilioError(401, 20003)]);
    expect(await sendOn(bad.service)).toMatchObject({ outcome: 'refused', reason: 'credentials' });
    const odd = await connected(TWILIO, [twilioError(400, 99999)]);
    expect(await sendOn(odd.service)).toMatchObject({ outcome: 'refused', reason: 'provider-refused', providerCode: '99999' });
  });

  it('does not call Twilio again after an unknown attempt, whatever the caller asks', async () => {
    const { service, seen } = await connected(TWILIO, [networkError('ECONNRESET')]);
    const first = await sendOn(service);
    const again = await sendOn(service, { earlier: { mayHaveGoneAt: 1_000_000, account: first.account } });
    expect(again).toMatchObject({ outcome: 'unknown', reason: 'earlier-attempt-unknown', resend: 'check-first' });
    expect(seen).toHaveLength(1);
  });

  it('does retry after an attempt that certainly was not taken', async () => {
    const { service, seen } = await connected(TWILIO, [networkError('ECONNREFUSED'), twilioSent()]);
    const first = await sendOn(service);
    expect(afterAttempt(null, first, 1_000_000)).toBeNull();
    const again = await sendOn(service, { earlier: afterAttempt(null, first, 1_000_000) });
    expect(again.outcome).toBe('accepted');
    expect(seen).toHaveLength(2);
  });
});

describe('an answer that breaks off', () => {
  const cutOff = (status: number) =>
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"sid":')); controller.error(new Error('socket closed')); } }), { status });

  it('a success whose body is cut off is unknown: Twilio, check first', async () => {
    const { service } = await connected(TWILIO, [cutOff(201)]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'unreadable-reply', resend: 'check-first' });
  });

  it('a success whose body is cut off is unknown: Telnyx, same key', async () => {
    const { service } = await connected(TELNYX, [cutOff(200)]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'unreadable-reply', resend: 'same-key' });
  });

  it('a reply too large to read is unknown, never accepted', async () => {
    const { service } = await connected(TWILIO, [new Response(`{"sid":"SM1","pad":"${'x'.repeat(300 * 1024)}"}`, { status: 201 })]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'unreadable-reply' });
  });

  it('a caller stopping mid-way is unknown: the text may have gone', async () => {
    const { service } = await connected(TWILIO, ['hang']);
    const stop = new AbortController();
    const sending = sendOn(service, { signal: stop.signal });
    setTimeout(() => stop.abort(), 3);
    expect(await sending).toMatchObject({ outcome: 'unknown', reason: 'connection-lost', resend: 'check-first' });
  });
});

describe('the marker between tries', () => {
  const HOUR = 60 * 60 * 1000;

  it('stays set through a later answer of not-taken, so the window still ends (Telnyx)', async () => {
    const clock = { now: 1_000_000 };
    const { service, seen } = await connected(TELNYX, ['hang', telnyxError(429, '10011')], clock);
    const first = await sendOn(service);
    let marker = afterAttempt(null, first, 1_000_000);
    expect(marker).toEqual({ mayHaveGoneAt: 1_000_000, account: first.account });
    clock.now += HOUR;
    const second = await sendOn(service, { earlier: marker });
    expect(second.outcome).toBe('not-taken');
    marker = afterAttempt(marker, second, clock.now);
    expect(marker?.mayHaveGoneAt).toBe(1_000_000);
    clock.now = 1_000_000 + 23 * HOUR;
    expect(await sendOn(service, { earlier: marker })).toMatchObject({ outcome: 'unknown', reason: 'replay-window-passed', resend: 'check-first' });
    expect(seen).toHaveLength(2);
  });

  it('starts at the first try that may have gone, not at an earlier refused connection', async () => {
    const clock = { now: 1_000_000 };
    const { service } = await connected(TELNYX, [networkError('ECONNREFUSED'), 'hang'], clock);
    let marker = afterAttempt(null, await sendOn(service), clock.now);
    expect(marker).toBeNull();
    clock.now += HOUR;
    const at = clock.now;
    marker = afterAttempt(marker, await sendOn(service, { earlier: marker }), at);
    expect(marker?.mayHaveGoneAt).toBe(at);
  });

  it('keeps Twilio from ever being called again after an unknown', async () => {
    const { service, seen } = await connected(TWILIO, [networkError('ECONNRESET')]);
    const first = await sendOn(service);
    const marker = afterAttempt(null, first, 1_000_000);
    for (let i = 0; i < 3; i += 1) expect((await sendOn(service, { earlier: marker })).outcome).toBe('unknown');
    expect(seen).toHaveLength(1);
  });
});

describe('Twilio: the check', () => {
  const check = async (reply: Answer) => {
    const { service, queue } = await connected(TWILIO);
    queue.push(reply);
    return (await service.recheck()).check;
  };

  it('never keeps the auth token or the plain name the account reply carries', async () => {
    const { service, store } = await connected(TWILIO);
    const view = await service.view();
    expect(view?.accountName).toBe('ow•••le');
    expect(JSON.stringify(view)).not.toContain('owner@');
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(JSON.stringify(store.row)).not.toContain(TOKEN);
    expect(JSON.stringify(store.row)).not.toContain('owner@');
  });

  it('names what is wrong', async () => {
    expect(await check(twilioAccount({ status: 'suspended' }))).toMatchObject({ ok: false, reason: 'account-suspended' });
    expect(await check(twilioAccount({ status: 'closed' }))).toMatchObject({ ok: false, reason: 'account-closed' });
    expect(await check(twilioError(401, 20003))).toMatchObject({ ok: false, reason: 'credentials-refused' });
    expect(await check(new Response('', { status: 404 }))).toMatchObject({ ok: false, reason: 'credentials-refused' });
    expect(await check(new Response('', { status: 503 }))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await check(networkError('ECONNREFUSED'))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await check(twilioAccount({ sid: `AC${'00'.repeat(16)}` }))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await check(twilioAccount({ status: 'something-new' }))).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('says when the account is a trial', async () => {
    const { service, queue } = await connected(TWILIO);
    queue.push(twilioAccount({ type: 'Trial' }));
    expect((await service.recheck()).accountType).toBe('trial');
  });
});

describe('Telnyx: sending', () => {
  it('posts the documented JSON with its key and reads the reply', async () => {
    const { service, seen } = await connected(TELNYX, [telnyxSent()]);
    const result = await sendOn(service, { callbackUrl: 'https://crm.lumen.example/hook' });
    expect(result).toMatchObject({ outcome: 'accepted', provider: 'telnyx', status: 'queued', segments: 1, price: { amount: '0.0051', currency: 'USD' }, replayed: false });
    const call = seen[0]!;
    expect(call.url).toBe('https://api.telnyx.com/v2/messages');
    expect(call.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(call.headers.get('idempotency-key')).toBe(KEY);
    expect(call.redirect).toBe('manual');
    expect(JSON.parse(call.body)).toEqual({ to: TO, from: FROM, text: BODY, type: 'SMS', webhook_url: 'https://crm.lumen.example/hook' });
  });

  it('sends a name through the profile, and a pool with no from', async () => {
    const named = await connected(TELNYX, [telnyxSent()]);
    await sendOn(named.service, { sender: { kind: 'name', value: 'Lumen' } });
    expect(JSON.parse(named.seen[0]!.body)).toMatchObject({ from: 'Lumen', messaging_profile_id: PROFILE });
    const pool = await connected(TELNYX, [telnyxSent()]);
    await sendOn(pool.service, { sender: { kind: 'pool', value: PROFILE } });
    const body = JSON.parse(pool.seen[0]!.body) as Record<string, unknown>;
    expect(body['messaging_profile_id']).toBe(PROFILE);
    expect(body['from']).toBeUndefined();
  });

  it.each([
    ['40300', 'opted-out'],
    ['40310', 'invalid-number'],
    ['40012', 'invalid-number'],
    ['40305', 'invalid-sender'],
    ['40306', 'sender-name-refused'],
    ['40309', 'country-not-enabled'],
    ['40333', 'spend-limit'],
    ['40322', 'content-blocked'],
    ['40312', 'account-disabled'],
  ])('reads code %s as refused: %s', async (code, reason) => {
    const { service } = await connected(TELNYX, [telnyxError(400, code)]);
    const result = await sendOn(service);
    expect(result).toMatchObject({ outcome: 'refused', reason, providerCode: code });
    expect(JSON.stringify(result)).not.toContain(BODY);
  });

  it('finds an opt-out among several errors, by its code alone', async () => {
    const { service } = await connected(TELNYX, [telnyxError(422, '40310', '40300')]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'refused', reason: 'opted-out', providerCode: '40300' });
  });

  it.each([
    ['40318', 'queue-full'],
    ['40320', 'sender-busy'],
  ])('reads code %s as not taken', async (code, reason) => {
    const { service } = await connected(TELNYX, [telnyxError(400, code)]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'not-taken', reason });
  });

  it('retries a timeout with the same key, and reads the replay as the earlier send', async () => {
    const clock = { now: 1_000_000 };
    const { service, seen } = await connected(TELNYX, ['hang', telnyxSent({ 'idempotent-replayed': 'true' })], clock);
    const first = await sendOn(service);
    expect(first).toMatchObject({ outcome: 'unknown', reason: 'timeout', resend: 'same-key' });
    clock.now += 60_000;
    const again = await sendOn(service, { earlier: { mayHaveGoneAt: 1_000_000, account: first.account } });
    expect(again).toMatchObject({ outcome: 'accepted', replayed: true });
    expect(seen.map((call) => call.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
    expect(seen[0]!.body).toBe(seen[1]!.body);
  });

  it('reads a 409 as still in progress: same key, later', async () => {
    const { service } = await connected(TELNYX, [telnyxError(409, '10036')]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'in-progress', resend: 'same-key', providerCode: '10036' });
  });

  it('reads a 422 with no message code as a reused key: never a failure to resend', async () => {
    const { service } = await connected(TELNYX, [telnyxError(422, '10099')]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'key-reused', resend: 'check-first' });
  });

  it('reads 5xx, its idempotency outage (503, 10016) and a lost connection as unknown, same key', async () => {
    for (const answer of [telnyxError(503, '10016'), new Response('', { status: 500 }), networkError('ECONNRESET')]) {
      const { service } = await connected(TELNYX, [answer]);
      expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', resend: 'same-key' });
    }
  });

  it('reads a 429 and a refused connection as not taken', async () => {
    const limited = await connected(TELNYX, [telnyxError(429, '10011')]);
    expect(await sendOn(limited.service)).toMatchObject({ outcome: 'not-taken', reason: 'rate-limited' });
    const refused = await connected(TELNYX, [networkError('ECONNREFUSED')]);
    expect(await sendOn(refused.service)).toMatchObject({ outcome: 'not-taken', reason: 'no-connection' });
  });

  it('reads a refused key, a body over its limit and a bad request as refusals', async () => {
    const bad = await connected(TELNYX, [telnyxError(401, '10009')]);
    expect(await sendOn(bad.service)).toMatchObject({ outcome: 'refused', reason: 'credentials' });
    const large = await connected(TELNYX, [telnyxError(413, '10007')]);
    expect(await sendOn(large.service)).toMatchObject({ outcome: 'refused', reason: 'body-too-long' });
    const odd = await connected(TELNYX, [telnyxError(400, '10015')]);
    expect(await sendOn(odd.service)).toMatchObject({ outcome: 'refused', reason: 'provider-refused' });
  });

  it('reads a success with no readable id as unknown, same key', async () => {
    const { service } = await connected(TELNYX, [json(200, { data: { to: [] } })]);
    expect(await sendOn(service)).toMatchObject({ outcome: 'unknown', reason: 'unreadable-reply', resend: 'same-key' });
  });

  describe('the replay window', () => {
    const HOUR = 60 * 60 * 1000;

    it('stops retrying before the 24 hours run out', async () => {
      const clock = { now: 1_000_000 };
      const { service, seen } = await connected(TELNYX, ['hang', telnyxSent()], clock);
      const first = await sendOn(service);
      clock.now = 1_000_000 + 23 * HOUR - 1;
      expect((await sendOn(service, { earlier: { mayHaveGoneAt: 1_000_000, account: first.account } })).outcome).toBe('accepted');
      expect(seen).toHaveLength(2);
      clock.now = 1_000_000 + 23 * HOUR;
      const late = await sendOn(service, { earlier: { mayHaveGoneAt: 1_000_000, account: first.account } });
      expect(late).toMatchObject({ outcome: 'unknown', reason: 'replay-window-passed', resend: 'check-first' });
      expect(seen).toHaveLength(2);
    });

    it('does not trust a first attempt dated in the future', async () => {
      const { service, seen } = await connected(TELNYX, ['hang']);
      const first = await sendOn(service);
      const odd = await sendOn(service, { earlier: { mayHaveGoneAt: 2_000_000, account: first.account } });
      expect(odd).toMatchObject({ outcome: 'unknown', reason: 'replay-window-passed' });
      expect(seen).toHaveLength(1);
    });

    it('does not resend when the first try was at another account: the key means nothing there', async () => {
      const { service, seen } = await connected(TELNYX, ['hang']);
      await sendOn(service);
      const moved = await sendOn(service, { earlier: { mayHaveGoneAt: 1_000_000, account: 'another-account' } });
      expect(moved).toMatchObject({ outcome: 'unknown', reason: 'earlier-attempt-unknown', resend: 'check-first' });
      expect(seen).toHaveLength(1);
    });
  });
});

describe('Telnyx: a sender on another profile', () => {
  it('is refused when the provider says so', async () => {
    const { service } = await connected(TELNYX, [], { now: 1_000_000 });
    expect(await service.view()).toMatchObject({ sender: { value: FROM } });
    await expect(connected(TELNYX, [], { now: 1_000_000 }, '99999999-2222-4333-8444-555555555555')).rejects.toMatchObject({ details: { reason: 'SENDER_OTHER_PROFILE' } });
  });

  it('is kept when the number is on this profile', async () => {
    const { service } = await connected(TELNYX, [], { now: 1_000_000 }, PROFILE.toUpperCase());
    expect(await service.view()).toMatchObject({ sender: { value: FROM } });
  });
});

describe('Telnyx: the check', () => {
  const check = async (reply: Answer) => {
    const { service, queue } = await connected(TELNYX);
    queue.push(reply);
    return (await service.recheck()).check;
  };

  it('asks about the saved profile and masks its name', async () => {
    const { service, seen, queue } = await connected(TELNYX);
    queue.push(telnyxProfile());
    const view = await service.recheck();
    expect(seen[0]!.url).toBe(`https://api.telnyx.com/v2/messaging_profiles/${PROFILE}`);
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(view.accountName).toBe('Lu•••ro');
    expect(view.timeoutRetry).toBe('same-key');
  });

  it('names what is wrong', async () => {
    expect(await check(telnyxProfile({ enabled: false }))).toMatchObject({ ok: false, reason: 'account-disabled' });
    expect(await check(telnyxError(401, '10009'))).toMatchObject({ ok: false, reason: 'credentials-refused' });
    expect(await check(telnyxError(404, '10005'))).toMatchObject({ ok: false, reason: 'profile-not-found' });
    expect(await check(new Response('', { status: 500 }))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await check(networkError('ENOTFOUND'))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await check(telnyxProfile({ id: '99999999-2222-4333-8444-555555555555' }))).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('the code tables', () => {
  it('keep each provider\'s opt-out as its own reason', () => {
    expect(TWILIO_CODES['21610']).toEqual({ kind: 'refused', reason: 'opted-out' });
    expect(TELNYX_CODES['40300']).toEqual({ kind: 'refused', reason: 'opted-out' });
    const others = [...Object.entries(TWILIO_CODES), ...Object.entries(TELNYX_CODES)].filter(([, meaning]) => meaning.kind === 'refused' && meaning.reason === 'opted-out');
    expect(others.map(([code]) => code).sort()).toEqual(['21610', '40300']);
  });
});
