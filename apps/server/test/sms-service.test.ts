// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS account: keys sealed and never shown, a key saved only when the
 * provider accepts it, who may be texted, and the test text. Provider replies
 * are stubs from the documentation; no real provider is called.
 */
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { encryptSecret } from '../src/config/secrets.js';
import { AppError, ConflictError, RateLimitedError, ValidationFailedError } from '../src/errors.js';
import { maskAccountName, openCredentials, readCredentialInput, readSender, sealCredentials, senderTakesReplies, smsSecretKey, SmsSecret, type SmsCredentialInput } from '../src/sms/credentials.js';
import { checkDestination, phoneHint } from '../src/sms/destination.js';
import { createSmsService, SMS_MAX_BODY, SMS_TEST_BODY, SMS_TEST_LIMIT, SMS_TEST_WINDOW_MS, type SmsStopList } from '../src/sms/index.js';
import { memorySmsStore } from './helpers/sms-store.js';

const SECRET = 'an-sms-service-test-secret-of-length';
const SID = `AC${'ab'.repeat(16)}`;
const OTHER_SID = `AC${'cd'.repeat(16)}`;
const TOKEN = 'made-up-token-for-these-tests';
const API_KEY = 'made-up-telnyx-key-for-tests';
const PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const PROFILE = '11111111-2222-4333-8444-555555555555';
const FROM = '+14155550100';
const US = '+14155552671';
const UK_MOBILE = '+447400123456';
const UK_LANDLINE = '+442079460958';

const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: SID, authToken: TOKEN };
const TELNYX: SmsCredentialInput = { provider: 'telnyx', apiKey: API_KEY, publicKey: PUBLIC_KEY, messagingProfileId: PROFILE };

const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const sent = () => json(201, { sid: `SM${'cd'.repeat(16)}`, status: 'queued', num_segments: '1', price: null, price_unit: 'USD' });

/** Answers each account check as the SID in its URL, and each send from `sends`. */
function provider(sends: Response[] = []) {
  const calls: { url: string; method: string; body: string }[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: address, method, body: typeof init?.body === 'string' ? init.body : '' });
    if (method === 'GET' && address.includes('messaging_profiles')) return json(200, { data: { id: PROFILE, name: 'Lumen Bistro', enabled: true } });
    if (method === 'GET') {
      const sid = /Accounts\/([^.]+)\.json/.exec(address)?.[1];
      return json(200, { sid, friendly_name: 'Lumen Bistro', status: 'active', type: 'Full', auth_token: TOKEN });
    }
    return sends.shift() ?? sent();
  }) as typeof fetch;
  return { calls, fetchStub, sends: () => calls.filter((call) => call.method === 'POST') };
}

function stopList(stopped: string[] = []): SmsStopList & { recorded: { e164: string; provider: string }[] } {
  const recorded: { e164: string; provider: string }[] = [];
  return { recorded, isStopped: async (e164) => stopped.includes(e164), recordProviderOptOut: async (entry) => void recorded.push(entry) };
}

function build(over: { sends?: Response[]; stopped?: string[]; clock?: { now: number }; secret?: string } = {}) {
  const store = memorySmsStore();
  const remote = provider(over.sends);
  const stops = stopList(over.stopped);
  const clock = over.clock ?? { now: 1_000_000 };
  const service = createSmsService({ store, secret: over.secret ?? SECRET, fetch: remote.fetchStub, now: () => clock.now, stopList: stops });
  return { store, remote, stops, clock, service };
}

async function ready(over: Parameters<typeof build>[0] = {}) {
  const built = build(over);
  await built.service.connect(TWILIO, 'person-1');
  await built.service.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'US' }, 'person-1');
  return built;
}

async function refusal(work: Promise<unknown>): Promise<AppError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('keys at rest', () => {
  it('keeps only a sealed value, under its own key', async () => {
    const { store } = await ready();
    expect(store.row?.sealedCredentials.startsWith('enc:v1:')).toBe(true);
    for (const fields of store.writes) expect(JSON.stringify(fields)).not.toContain(TOKEN);
    expect(openCredentials(store.row!.sealedCredentials, 'twilio', smsSecretKey(SECRET))).toMatchObject({ provider: 'twilio', accountSid: SID });
    expect(openCredentials(store.row!.sealedCredentials, 'twilio', smsSecretKey('another-server-secret-of-length'))).toBeNull();
  });

  it('seals each save afresh', async () => {
    const key = smsSecretKey(SECRET);
    const credentials = readCredentialInput(TWILIO);
    if (!credentials.ok) throw new Error('expected a valid paste');
    expect(sealCredentials(credentials.credentials, key)).not.toBe(sealCredentials(credentials.credentials, key));
  });

  it('refuses a sealed value that is another provider\'s, malformed, or carries an odd identifier', () => {
    const key = smsSecretKey(SECRET);
    const pasted = readCredentialInput(TWILIO);
    if (!pasted.ok) throw new Error('expected a valid paste');
    expect(openCredentials(sealCredentials(pasted.credentials, key), 'telnyx', key)).toBeNull();
    expect(openCredentials('enc:v1:AAAA', 'twilio', key)).toBeNull();
    expect(openCredentials(encryptSecret('not json', key), 'twilio', key)).toBeNull();
    const reshaped = encryptSecret(JSON.stringify({ provider: 'twilio', accountSid: `../../${SID}`, authToken: TOKEN }), key);
    expect(openCredentials(reshaped, 'twilio', key)).toBeNull();
  });

  it('an opened secret never prints', () => {
    const secret = new SmsSecret(TOKEN);
    const holder = { authToken: secret };
    expect(JSON.stringify(holder)).not.toContain(TOKEN);
    expect(String(secret)).toBe('[secret]');
    expect(`${secret.toString()}`).toBe('[secret]');
    expect(inspect(holder, { depth: 5 })).not.toContain(TOKEN);
    expect(secret.reveal()).toBe(TOKEN);
  });

  it('after the server\'s secret changes: asks for the key again and sends nothing', async () => {
    const first = await ready();
    const moved = createSmsService({ store: first.store, secret: 'a-different-server-secret-of-length', fetch: first.remote.fetchStub, stopList: stopList() });
    expect((await moved.view())?.keyReadable).toBe(false);
    expect(await moved.credentials()).toBeNull();
    expect(await moved.send({ to: US, body: 'hello', idempotencyKey: 'k1' })).toMatchObject({ outcome: 'refused', reason: 'not-connected' });
    expect(first.remote.sends()).toHaveLength(0);
  });
});

describe('the check on save', () => {
  it('saves a key the provider accepts, and says whose it is', async () => {
    const { service } = build();
    const { view, replaced, accountChanged } = await service.connect(TWILIO, 'person-1');
    expect(view).toMatchObject({ provider: 'twilio', accountName: 'Lu•••ro', accountHint: '…abab', accountType: 'full', keyReadable: true, sender: null, timeoutRetry: 'never' });
    expect(view.check.ok).toBe(true);
    expect({ replaced, accountChanged }).toEqual({ replaced: false, accountChanged: false });
  });

  it('never saves a key the provider refused, and the one already here stays', async () => {
    const built = await ready();
    const before = built.store.row!.sealedCredentials;
    const failing = createSmsService({ store: built.store, secret: SECRET, fetch: (async () => json(401, { status: 401, code: 20003, message: 'no' })) as unknown as typeof fetch, stopList: stopList() });
    const error = await refusal(failing.connect({ ...TWILIO, authToken: 'another-made-up-token-here' }, 'person-2'));
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect(error.details).toMatchObject({ reason: 'credentials-refused' });
    expect(built.store.row!.sealedCredentials).toBe(before);
  });

  it('does not save a key it could not check', async () => {
    const store = memorySmsStore();
    const down = createSmsService({ store, secret: SECRET, fetch: (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch, stopList: stopList() });
    const error = await refusal(down.connect(TWILIO, null));
    expect(error.details).toMatchObject({ reason: 'unreachable' });
    expect(store.row).toBeNull();
  });

  it('refuses a wrong paste before calling anyone, and the refusal holds no value', async () => {
    const { service, remote } = build();
    const cases: [SmsCredentialInput, string][] = [
      [{ ...TWILIO, accountSid: `SK${'ab'.repeat(16)}` }, 'KEY_SID_IN_ACCOUNT_FIELD'],
      [{ ...TWILIO, accountSid: 'not-a-sid' }, 'NOT_AN_ACCOUNT_SID'],
      [{ ...TWILIO, accountSid: `../${SID}` }, 'NOT_AN_ACCOUNT_SID'],
      [{ ...TWILIO, authToken: SID }, 'SID_IN_TOKEN_FIELD'],
      [{ ...TWILIO, authToken: 'two words here for a token' }, 'HAS_SPACES'],
      [{ ...TWILIO, authToken: '   ' }, 'EMPTY'],
      [{ ...TWILIO, authToken: 'short' }, 'NOT_A_KEY'],
      [{ ...TELNYX, publicKey: 'bm90IGEga2V5' }, 'NOT_A_PUBLIC_KEY'],
      [{ ...TELNYX, messagingProfileId: 'x/../y' }, 'NOT_A_PROFILE_ID'],
      [{ ...TELNYX, apiKey: 'tiny' }, 'NOT_A_KEY'],
    ];
    for (const [input, code] of cases) {
      const error = await refusal(service.connect(input, null));
      expect(error.details).toMatchObject({ reason: code });
      expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(TOKEN);
    }
    expect(remote.calls).toHaveLength(0);
  });

  it('a save that lost a race changes nothing', async () => {
    const store = memorySmsStore();
    const base = provider();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const slow = (async (url: string | URL | Request, init?: RequestInit) => { await held; return base.fetchStub(url, init); }) as typeof fetch;
    const slower = createSmsService({ store, secret: SECRET, fetch: slow, stopList: stopList() });
    const faster = createSmsService({ store, secret: SECRET, fetch: base.fetchStub, stopList: stopList() });
    const racing = slower.connect({ ...TWILIO, accountSid: OTHER_SID }, 'slow');
    await faster.connect(TWILIO, 'fast');
    release();
    await expect(racing).rejects.toBeInstanceOf(ConflictError);
    expect(store.row?.savedBy).toBe('fast');
    expect(store.row?.accountHint).toBe('…abab');
  });

  it('keeps the sender for a new key on the same account, and drops it for another account', async () => {
    const same = await ready();
    const again = await same.service.connect({ ...TWILIO, authToken: 'a-rotated-made-up-token-here' }, 'person-1');
    expect(again).toMatchObject({ replaced: true, accountChanged: false });
    expect(again.view.sender).toEqual({ kind: 'number', value: FROM });

    const other = await ready();
    const moved = await other.service.connect({ ...TWILIO, accountSid: OTHER_SID }, 'person-1', { confirmAccountChange: true });
    expect(moved).toMatchObject({ replaced: true, accountChanged: true });
    expect(moved.view.sender).toBeNull();
    expect(moved.view.defaultCountry).toBe('US');
  });

  it('asks before keys that open another account replace the readable one, and keeps the old one meanwhile', async () => {
    const built = await ready();
    const hint = built.store.row?.accountHint;
    const refused = built.service.connect({ ...TWILIO, accountSid: OTHER_SID }, 'person-1');
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toMatchObject({ details: { reason: 'account-changed' } });
    expect(built.store.row?.accountHint).toBe(hint);
    expect((await built.service.view())?.sender).toEqual({ kind: 'number', value: FROM });
  });

  it('counts a key that no longer opened as another account', async () => {
    const first = await ready();
    const moved = createSmsService({ store: first.store, secret: 'a-different-server-secret-of-length', fetch: first.remote.fetchStub, stopList: stopList() });
    expect(await moved.connect(TWILIO, 'person-1')).toMatchObject({ replaced: true, accountChanged: true });
  });

  it('records a later check that fails, keeping the key', async () => {
    const built = await ready();
    const failing = createSmsService({ store: built.store, secret: SECRET, fetch: (async () => json(401, { status: 401, code: 20003, message: 'no' })) as unknown as typeof fetch, stopList: stopList() });
    const view = await failing.recheck();
    expect(view.check).toMatchObject({ ok: false, reason: 'credentials-refused' });
    expect(view.keyReadable).toBe(true);
  });

  it('removes the account', async () => {
    const { service, store } = await ready();
    expect(await service.disconnect()).toBe(true);
    expect(store.row).toBeNull();
    expect(await service.disconnect()).toBe(false);
  });
});

describe('senders', () => {
  const twilio = readCredentialInput(TWILIO);
  const telnyx = readCredentialInput(TELNYX);
  if (!twilio.ok || !telnyx.ok) throw new Error('expected valid pastes');

  it('reads a number to its exact form', () => {
    expect(readSender({ kind: 'number', value: '+1 (415) 555-0100' }, twilio.credentials)).toEqual({ ok: true, sender: { kind: 'number', value: FROM } });
    expect(readSender({ kind: 'number', value: '12345' }, twilio.credentials)).toEqual({ ok: false, code: 'NOT_A_NUMBER' });
    expect(readSender({ kind: 'number', value: '+14155550100 x7' }, twilio.credentials)).toEqual({ ok: false, code: 'NOT_A_NUMBER' });
  });

  it('takes a name of up to 11 letters, digits and spaces, with a letter in it', () => {
    expect(readSender({ kind: 'name', value: 'Lumen Bistr' }, twilio.credentials).ok).toBe(true);
    for (const value of ['Lumen Bistro', '12345', 'Lu-men', 'Lümen']) {
      expect(readSender({ kind: 'name', value }, twilio.credentials)).toEqual({ ok: false, code: 'NOT_A_NAME' });
    }
  });

  it('takes a pool only as that provider writes it', () => {
    expect(readSender({ kind: 'pool', value: `MG${'ef'.repeat(16)}` }, twilio.credentials).ok).toBe(true);
    expect(readSender({ kind: 'pool', value: PROFILE }, twilio.credentials)).toEqual({ ok: false, code: 'NOT_A_POOL' });
    expect(readSender({ kind: 'pool', value: PROFILE.toUpperCase() }, telnyx.credentials)).toEqual({ ok: true, sender: { kind: 'pool', value: PROFILE } });
    expect(readSender({ kind: 'pool', value: '99999999-2222-4333-8444-555555555555' }, telnyx.credentials)).toEqual({ ok: false, code: 'NOT_A_POOL' });
  });

  it('says a name cannot take a reply, and a pool is not a yes', () => {
    expect(senderTakesReplies({ kind: 'number', value: FROM })).toBe('yes');
    expect(senderTakesReplies({ kind: 'name', value: 'Lumen' })).toBe('no');
    expect(senderTakesReplies({ kind: 'pool', value: 'x' })).toBe('depends');
  });

  it('refuses a bad sender or country on save', async () => {
    const { service } = await ready();
    expect((await refusal(service.setSending({ sender: { kind: 'name', value: 'Way too long a name' }, defaultCountry: null }, null))).details).toMatchObject({ reason: 'NOT_A_NAME' });
    expect((await refusal(service.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'XX' }, null))).details).toMatchObject({ reason: 'BAD_COUNTRY' });
    expect((await refusal(service.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'us' }, null))).details).toMatchObject({ reason: 'BAD_COUNTRY' });
  });

  it('needs an account first', async () => {
    const { service } = build();
    expect((await refusal(service.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: null }, null))).details).toMatchObject({ reason: 'not-connected' });
    expect((await refusal(service.recheck())).details).toMatchObject({ reason: 'not-connected' });
  });
});

describe('who may be texted', () => {
  it('refuses mainland China with its own reason', () => {
    expect(checkDestination('+8613812345678', null)).toMatchObject({ ok: false, reason: 'country-blocked-cn', e164: '+8613812345678' });
    expect(checkDestination('13812345678', 'CN')).toMatchObject({ ok: false, reason: 'country-blocked-cn' });
  });

  it('keeps Hong Kong, Macao and Taiwan', () => {
    for (const number of ['+85251234567', '+85366123456', '+886912345678']) expect(checkDestination(number, null).ok, number).toBe(true);
  });

  it('sends to `maybe` and refuses `no`', () => {
    const maybe = checkDestination(US, null);
    expect(maybe.ok && maybe.phone.receivesText).toBe('maybe');
    expect(checkDestination(UK_MOBILE, null).ok).toBe(true);
    expect(checkDestination(UK_LANDLINE, null)).toMatchObject({ ok: false, reason: 'cannot-receive-text', detail: 'landline' });
    expect(checkDestination('+1 415 555 2671 x7', null)).toMatchObject({ ok: false, reason: 'cannot-receive-text' });
  });

  it('refuses what cannot be read, with the phone module\'s reason', () => {
    expect(checkDestination('12345', 'US')).toMatchObject({ ok: false, reason: 'bad-number', detail: 'too-short' });
    expect(checkDestination('', 'US')).toMatchObject({ ok: false, reason: 'bad-number', detail: 'empty' });
    expect(checkDestination(4155552671, 'US')).toMatchObject({ ok: false, reason: 'bad-number', detail: 'not-text' });
    expect(checkDestination('415 555 2671', null)).toMatchObject({ ok: false, reason: 'bad-number', detail: 'needs-country' });
  });

  it('calls no provider for any of them, and sends only the exact number', async () => {
    const { service, remote } = await ready();
    for (const to of ['+8613812345678', UK_LANDLINE, '12345', null]) {
      expect((await service.send({ to, body: 'hello', idempotencyKey: 'k1' })).outcome).toBe('refused');
    }
    expect(remote.sends()).toHaveLength(0);
    await service.send({ to: '(415) 555-2671', body: 'hello', idempotencyKey: 'k1' });
    expect(new URLSearchParams(remote.sends()[0]!.body).get('To')).toBe(US);
  });

  it('shows a number in an audit row by its last two digits', () => {
    expect(phoneHint(US)).toBe('+…71');
    expect(phoneHint(null)).toBeNull();
  });
});

describe('what a send refuses before any call', () => {
  it.each([
    ['an empty body', { body: '   ' }, 'body-empty'],
    ['a body over the limit', { body: 'x'.repeat(SMS_MAX_BODY + 1) }, 'body-too-long'],
    ['an empty key', { idempotencyKey: '' }, 'bad-request'],
    ['a key over 255', { idempotencyKey: 'k'.repeat(256) }, 'bad-request'],
    ['a key with odd characters', { idempotencyKey: 'has space' }, 'bad-request'],
    ['a plain http callback', { callbackUrl: 'http://crm.lumen.example/hook' }, 'bad-request'],
    ['a callback host with an underscore', { callbackUrl: 'https://crm_lumen.example/hook' }, 'bad-request'],
    ['a callback with a password', { callbackUrl: 'https://a:b@crm.lumen.example/hook' }, 'bad-request'],
    ['a sender that is no sender', { sender: { kind: 'name' as const, value: 'Far too long a name' } }, 'invalid-sender'],
  ])('%s', async (_name, over, reason) => {
    const { service, remote } = await ready();
    expect(await service.send({ to: US, body: 'hello', idempotencyKey: 'k1', ...over })).toMatchObject({ outcome: 'refused', reason });
    expect(remote.sends()).toHaveLength(0);
  });

  it('takes a body at exactly the limit', async () => {
    const { service } = await ready();
    expect((await service.send({ to: US, body: 'x'.repeat(SMS_MAX_BODY), idempotencyKey: 'k1' })).outcome).toBe('accepted');
  });

  it('needs an account and a sender', async () => {
    const empty = build();
    expect(await empty.service.send({ to: US, body: 'hello', idempotencyKey: 'k1' })).toMatchObject({ outcome: 'refused', reason: 'not-connected', to: US });
    const noSender = build();
    await noSender.service.connect(TWILIO, null);
    expect(await noSender.service.send({ to: US, body: 'hello', idempotencyKey: 'k1' })).toMatchObject({ outcome: 'refused', reason: 'no-sender' });
    expect(noSender.remote.sends()).toHaveLength(0);
  });

  it('counts a caller that had already stopped as not taken', async () => {
    const { service, remote } = await ready();
    const stopped = new AbortController();
    stopped.abort();
    expect(await service.send({ to: US, body: 'hello', idempotencyKey: 'k1', signal: stopped.signal })).toMatchObject({ outcome: 'not-taken', reason: 'cancelled' });
    expect(remote.sends()).toHaveLength(0);
  });

  it('keeps no body in any answer', async () => {
    const body = 'A private message body 12345';
    const { service } = await ready({ sends: [json(201, { sid: `SM${'cd'.repeat(16)}`, status: 'queued', body })] });
    expect(JSON.stringify(await service.send({ to: US, body, idempotencyKey: 'k1' }))).not.toContain(body);
  });

  it('reports the same account reference for the same account, holding no identifier', async () => {
    const { service } = await ready();
    const one = await service.send({ to: US, body: 'one', idempotencyKey: 'k1' });
    const two = await service.send({ to: US, body: 'two', idempotencyKey: 'k2' });
    expect(one.account).toBe(two.account);
    expect(one.account).not.toContain(SID);
  });
});

describe('the test text', () => {
  it('sends the fixed words', async () => {
    const { service, remote } = await ready();
    expect((await service.sendTest(UK_MOBILE)).outcome).toBe('accepted');
    const form = new URLSearchParams(remote.sends()[0]!.body);
    expect(form.get('Body')).toBe(SMS_TEST_BODY);
    expect(form.get('To')).toBe(UK_MOBILE);
  });

  it('never texts someone on the stop list', async () => {
    const { service, remote } = await ready({ stopped: [UK_MOBILE] });
    expect(await service.sendTest(UK_MOBILE)).toMatchObject({ outcome: 'refused', reason: 'opted-out', to: UK_MOBILE });
    expect(remote.sends()).toHaveLength(0);
  });

  it('writes a provider\'s opt-out to the stop list', async () => {
    const { service, stops } = await ready({ sends: [json(400, { status: 400, code: 21610, message: 'unsubscribed' })] });
    expect(await service.sendTest(UK_MOBILE)).toMatchObject({ outcome: 'refused', reason: 'opted-out' });
    expect(stops.recorded).toEqual([{ e164: UK_MOBILE, provider: 'twilio' }]);
  });

  it('writes nothing for any other refusal', async () => {
    const { service, stops } = await ready({ sends: [json(400, { status: 400, code: 21211, message: 'bad' })] });
    await service.sendTest(UK_MOBILE);
    expect(stops.recorded).toEqual([]);
  });

  it('refuses +86 and a landline, and needs an account', async () => {
    const { service, remote } = await ready();
    expect(await service.sendTest('+8613812345678')).toMatchObject({ outcome: 'refused', reason: 'country-blocked-cn' });
    expect(await service.sendTest(UK_LANDLINE)).toMatchObject({ outcome: 'refused', reason: 'cannot-receive-text' });
    expect(remote.sends()).toHaveLength(0);
    expect(await build().service.sendTest(UK_MOBILE)).toMatchObject({ outcome: 'refused', reason: 'not-connected' });
  });

  it('is limited, and the limit passes', async () => {
    const clock = { now: 1_000_000 };
    const { service, remote } = await ready({ clock });
    for (let i = 0; i < SMS_TEST_LIMIT; i += 1) await service.sendTest(UK_MOBILE);
    await expect(service.sendTest(UK_MOBILE)).rejects.toBeInstanceOf(RateLimitedError);
    expect(remote.sends()).toHaveLength(SMS_TEST_LIMIT);
    clock.now += SMS_TEST_WINDOW_MS;
    expect((await service.sendTest(UK_MOBILE)).outcome).toBe('accepted');
  });
});

describe('the masked account name', () => {
  it.each([
    ['owner@lumen.example', 'ow•••le'],
    ['Lumen Bistro', 'Lu•••ro'],
    ['Lumen', 'L•••n'],
    ['Abc', 'A•••'],
    ['  ‮abc\u0000  ', 'a•••'],
  ])('%s', (raw, masked) => {
    expect(maskAccountName(raw)).toBe(masked);
  });

  it('gives nothing for no name', () => {
    expect(maskAccountName('   ')).toBeNull();
    expect(maskAccountName(null)).toBeNull();
    expect(maskAccountName(42)).toBeNull();
  });
});
