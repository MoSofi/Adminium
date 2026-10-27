// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Postmark, Brevo, Mailgun, SendGrid and "another service": each one's
 * documented sample taken with the right events; a changed byte, a wrong key or
 * credential, a stale timestamp and a replay refused where the service signs;
 * a batched body yielding every event.
 */
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createNoticeReader, createReplayGuard, noticeAnswer, NOTICE_SECRET_ROW, noticeAddress, NOTICE_SERVICES, type NoticeVerdict } from '../src/email/notices/index.js';
import { SENDGRID_SIGNATURE_HEADER, SENDGRID_TIMESTAMP_HEADER, sendgridKeyOf } from '../src/email/notices/sendgrid.js';
import { basicHeader, endpointFor, fixture, fixtureText, PATH_TOKEN, requestOf } from './relay-notice-helpers.js';

const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const NOW_S = Math.floor(NOW / 1000);
const reader = (now = NOW) => createNoticeReader({ now: () => now, replays: createReplayGuard({ now: () => now }), snsFetch: async () => Promise.reject(new Error('no network')) });

const POSTMARK = { user: 'adminium-postmark', pass: 'made-by-adminium-1' };

describe('Postmark', () => {
  const endpoint = endpointFor('postmark', { basic: POSTMARK });
  const read = (name: string, headers = basicHeader(POSTMARK.user, POSTMARK.pass)) => reader().read(requestOf(fixtureText(name), headers), endpoint);

  it('takes the documented hard bounce as permanent, keyed by its MessageID', async () => {
    expect(await read('postmark-bounce.json')).toEqual({
      genuine: true,
      events: [{ address: 'john@example.com', kind: 'bounce', permanent: true, relayEventId: '883953f4-6105-42a2-a16a-77a8eac79483:Bounce', at: Date.parse('2019-11-05T16:33:54.907Z') }],
    });
  });

  it('keeps a soft bounce off the list', async () => {
    expect(await read('postmark-soft-bounce.json')).toMatchObject({ genuine: true, events: [{ address: 'full-mailbox@example.com', permanent: false }] });
  });

  it('takes a spam complaint, and Postmark’s own unsubscribe through SubscriptionChange', async () => {
    expect(await read('postmark-spam-complaint.json')).toMatchObject({ genuine: true, events: [{ address: 'john@example.com', kind: 'complaint', permanent: true }] });
    expect(await read('postmark-subscription-change.json')).toMatchObject({ genuine: true, events: [{ address: 'bounced-address@example.com', kind: 'unsubscribe', permanent: true, at: Date.parse('2020-02-01T10:53:34.416Z') }] });
    const change = fixture('postmark-subscription-change.json');
    const of = async (over: Record<string, unknown>) => reader().read(requestOf(JSON.stringify({ ...change, ...over }), basicHeader(POSTMARK.user, POSTMARK.pass)), endpoint);
    expect(await of({ SuppressionReason: 'HardBounce' })).toMatchObject({ events: [{ kind: 'bounce', permanent: true }] });
    expect(await of({ SuppressionReason: 'SpamComplaint' })).toMatchObject({ events: [{ kind: 'complaint' }] });
    // Postmark lifting its own stop is not a yes to marketing mail.
    expect(await of({ SuppressSending: false })).toEqual({ genuine: true, events: [] });
  });

  it('refuses wrong credentials, none at all, and a wrong path token', async () => {
    expect(await read('postmark-bounce.json', basicHeader(POSTMARK.user, 'made-by-adminium-2'))).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect(await read('postmark-bounce.json', basicHeader('someone', POSTMARK.pass))).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect(await read('postmark-bounce.json', {})).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect(await read('postmark-bounce.json', { authorization: 'Bearer x' })).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect(await read('postmark-bounce.json', { authorization: `Basic ${Buffer.from('no-colon').toString('base64')}` })).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect(await reader().read(requestOf(fixtureText('postmark-bounce.json'), basicHeader(POSTMARK.user, POSTMARK.pass), 'another-token-of-the-right-length'), endpoint)).toEqual({ genuine: false, why: 'wrong-token' });
    expect(await reader().read(requestOf(fixtureText('postmark-bounce.json')), endpointFor('postmark'))).toEqual({ genuine: false, why: 'not-set-up' });
    expect(await reader().read(requestOf('[1]', basicHeader(POSTMARK.user, POSTMARK.pass)), endpoint)).toEqual({ genuine: false, why: 'malformed' });
  });
});

describe('Brevo', () => {
  const BREVO = { user: 'adminium-brevo', pass: 'made-by-adminium-3' };
  const endpoint = endpointFor('brevo', { basic: BREVO });
  const read = (body: string, headers = basicHeader(BREVO.user, BREVO.pass)) => reader().read(requestOf(body, headers), endpoint);

  it('takes the documented hard bounce', async () => {
    expect(await read(fixtureText('brevo-hard-bounce.json'))).toEqual({
      genuine: true,
      // Brevo's `message-id` is handed on as the mail's Message-ID: the send log's row, when it is a campaign mail's.
      events: [{ address: 'example@example.com', kind: 'bounce', permanent: true, relayEventId: '<201798300811.5787683@relay.domain.com>:hard_bounce', at: 1598634509223, messageId: '<201798300811.5787683@relay.domain.com>' }],
    });
  });

  it('yields every event of a batched body, soft bounces kept off the list', async () => {
    const verdict = await read(fixtureText('brevo-batch.json'));
    expect(verdict.genuine && verdict.events.map((e) => [e.address, e.kind, e.permanent])).toEqual([
      ['gone@example.com', 'bounce', true],
      ['full@example.com', 'bounce', false],
      ['angry@example.com', 'complaint', true],
      ['bye@example.com', 'unsubscribe', true],
    ]);
  });

  it('reads the camel-case spelling and a time in seconds, and takes Brevo’s own refusal as nothing new', async () => {
    const event = { event: 'hardBounce', email: 'Camel@Example.com', ts_event: 1598634509, 'message-id': '<x@y>' };
    expect(await read(JSON.stringify(event))).toMatchObject({ events: [{ address: 'camel@example.com', at: 1598634509000 }] });
    expect(await read(JSON.stringify({ event: 'blocked', email: 'a@example.com' }))).toEqual({ genuine: true, events: [] });
    // An event named after an object's own property finds nothing.
    expect(await read(JSON.stringify({ event: 'constructor', email: 'a@example.com' }))).toEqual({ genuine: true, events: [] });
    expect(await read(JSON.stringify({ event: 'invalid_email', email: 'a@example.com' }))).toMatchObject({ events: [{ kind: 'bounce', permanent: true, relayEventId: null, at: null }] });
  });

  it('refuses wrong credentials and bodies that are not Brevo’s', async () => {
    expect(await read(fixtureText('brevo-hard-bounce.json'), basicHeader(BREVO.user, 'nope'))).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect(await read('[]')).toEqual({ genuine: false, why: 'malformed' });
    expect(await read('[{"email":"a@example.com"}]')).toEqual({ genuine: false, why: 'malformed' });
    expect(await reader().read(requestOf('{}'), endpointFor('brevo'))).toEqual({ genuine: false, why: 'not-set-up' });
  });
});

describe('Mailgun', () => {
  const KEY = 'key-3ax6xnjp29jd6fds4gc373sgvjxteol0';
  const endpoint = endpointFor('mailgun', { signingKey: KEY });
  /** A fixture signed now (or at `at` seconds) with `key`. */
  const signedBody = (name: string, over: { at?: number; key?: string; token?: string } = {}) => {
    const body = fixture(name) as { signature: Record<string, string> };
    const timestamp = String(over.at ?? NOW_S - 30);
    const token = over.token ?? body.signature['token'] ?? '';
    body.signature = { timestamp, token, signature: createHmac('sha256', over.key ?? KEY).update(timestamp + token).digest('hex') };
    return JSON.stringify(body);
  };

  it('takes the documented permanent failure, complaint and unsubscribe', async () => {
    const r = reader();
    expect(await r.read(requestOf(signedBody('mailgun-permanent-fail.json')), endpoint)).toEqual({
      genuine: true,
      // The mail's own Message-ID, from the message's headers.
      events: [{ address: 'alice@example.com', kind: 'bounce', permanent: true, relayEventId: 'G9Bn5sl1TC6nu79C8C0bwg', at: 1521233195376, messageId: '20130503192659.13651.20287@sandboxes.mailgun.org' }],
    });
    expect(await r.read(requestOf(signedBody('mailgun-temporary-fail.json')), endpoint)).toMatchObject({ events: [{ permanent: false }] });
    expect(await r.read(requestOf(signedBody('mailgun-complained.json')), endpoint)).toMatchObject({ events: [{ kind: 'complaint', permanent: true }] });
    expect(await r.read(requestOf(signedBody('mailgun-unsubscribed.json')), endpoint)).toMatchObject({ events: [{ kind: 'unsubscribe', permanent: true }] });
  });

  it('refuses a wrong key, a changed timestamp or token, a stale signature, and a replay', async () => {
    const r = reader();
    expect(await r.read(requestOf(signedBody('mailgun-permanent-fail.json', { key: 'key-another' })), endpoint)).toEqual({ genuine: false, why: 'bad-signature' });
    const body = JSON.parse(signedBody('mailgun-permanent-fail.json')) as { signature: Record<string, string> };
    const tampered = { ...body, signature: { ...body.signature, timestamp: String(NOW_S - 29) } };
    expect(await r.read(requestOf(JSON.stringify(tampered)), endpoint)).toEqual({ genuine: false, why: 'bad-signature' });
    expect(await r.read(requestOf(signedBody('mailgun-permanent-fail.json', { at: NOW_S - 16 * 60 })), endpoint)).toEqual({ genuine: false, why: 'stale' });
    expect(await r.read(requestOf(signedBody('mailgun-permanent-fail.json', { at: NOW_S + 10 * 60 })), endpoint)).toEqual({ genuine: false, why: 'stale' });

    const genuine = signedBody('mailgun-permanent-fail.json');
    expect((await r.read(requestOf(genuine), endpoint)).genuine).toBe(true);
    expect(await r.read(requestOf(genuine), endpoint)).toEqual({ genuine: false, why: 'replay' });
  });

  it('refuses the captured signature on another body: the signature does not cover the body, the token is claimed', async () => {
    const r = reader();
    const genuine = JSON.parse(signedBody('mailgun-permanent-fail.json')) as Record<string, Record<string, unknown>>;
    expect((await r.read(requestOf(JSON.stringify(genuine)), endpoint)).genuine).toBe(true);
    const forged = { ...genuine, 'event-data': { ...genuine['event-data'], recipient: 'victim@example.com' } };
    expect(await r.read(requestOf(JSON.stringify(forged)), endpoint)).toEqual({ genuine: false, why: 'replay' });
  });

  it('refuses before setup, and bodies that are not Mailgun’s', async () => {
    expect(await reader().read(requestOf(signedBody('mailgun-permanent-fail.json')), endpointFor('mailgun'))).toEqual({ genuine: false, why: 'not-set-up' });
    expect(await reader().read(requestOf('{"event-data":{}}'), endpoint)).toEqual({ genuine: false, why: 'malformed' });
    expect(await reader().read(requestOf('{"signature":{"timestamp":"x","token":"t","signature":"s"}}'), endpoint)).toEqual({ genuine: false, why: 'malformed' });
    const noEvent = JSON.parse(signedBody('mailgun-permanent-fail.json', { token: 'fresh-token-1' })) as Record<string, unknown>;
    delete noEvent['event-data'];
    expect(await reader().read(requestOf(JSON.stringify(noEvent)), endpoint)).toEqual({ genuine: false, why: 'malformed' });
  });
});

describe('SendGrid', () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const VERIFICATION_KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const endpoint = endpointFor('sendgrid', { verificationKey: VERIFICATION_KEY });
  const headersFor = (body: string, at = NOW_S - 10, key = keys.privateKey) => ({
    [SENDGRID_TIMESTAMP_HEADER]: String(at),
    [SENDGRID_SIGNATURE_HEADER]: sign('sha256', Buffer.from(String(at) + body), key).toString('base64'),
  });

  it('takes the documented array: every event, each with the right kind and permanence', async () => {
    const body = fixtureText('sendgrid-events.json');
    const verdict = await reader().read(requestOf(body, headersFor(body)), endpoint);
    expect(verdict.genuine && verdict.events.map((e) => [e.address, e.kind, e.permanent, e.relayEventId])).toEqual([
      ['hard@example.com', 'bounce', true, '6g4ZI7SA-xmRDv57GoPIPw=='],
      ['soft@example.com', 'bounce', false, '6g4ZI7SA-xmRDv57GoPIPx=='],
      ['dropped@example.com', 'bounce', true, 'zmzJhfJgAfUSOW80yEbPyw=='],
      ['quota@example.com', 'bounce', false, 'zmzJhfJgAfUSOW80yEbPyx=='],
      ['spam@example.com', 'complaint', true, '37nvH5QBz858KGVYCM4uOA=='],
      ['unsub@example.com', 'unsubscribe', true, 'Krfn-yDfsMcjS0Nv5ozjEA=='],
      ['group@example.com', 'unsubscribe', true, 'ahSCB7xYcXFb-hEaawsPRw=='],
    ]);
    expect(verdict.genuine && verdict.events[0]?.at).toBe(1513299569000);
    // `smtp-id` is the Message-ID the mail went with, handed on where the event carries it.
    expect(verdict.genuine && verdict.events.map((e) => e.messageId ?? null)).toEqual([
      '<14c5d75ce93.dfd.64b469@ismtpd-555>',
      '<14c5d75ce93.dfd.64b469@ismtpd-555>',
      '<14c5d75ce93.dfd.64b469@ismtpd-555>',
      null,
      '<14c5d75ce93.dfd.64b469@ismtpd-555>',
      '<14c5d75ce93.dfd.64b469@ismtpd-555>',
      '<14c5d75ce93.dfd.64b469@ismtpd-555>',
    ]);
  });

  it('reads each dropped reason that is about the address', async () => {
    const events = ['Spam Reporting Address', 'Unsubscribed Address', 'Unsubscribed Group', 'Invalid'].map((reason, i) => ({ email: `d${String(i)}@example.com`, event: 'dropped', reason, timestamp: NOW_S }));
    const body = JSON.stringify([...events, { email: 'legacy@example.com', event: 'bounce', timestamp: NOW_S }, { email: 'proto@example.com', event: 'dropped', reason: 'constructor' }]);
    const verdict = await reader().read(requestOf(body, headersFor(body)), endpoint);
    expect(verdict.genuine && verdict.events.map((e) => [e.kind, e.permanent])).toEqual([
      ['complaint', true],
      ['unsubscribe', true],
      ['unsubscribe', true],
      ['bounce', true],
      ['bounce', true],
      ['bounce', false],
    ]);
  });

  it('refuses one byte changed, another key, a stale timestamp, and a replay', async () => {
    const r = reader();
    const body = fixtureText('sendgrid-events.json');
    const headers = headersFor(body);
    expect(await r.read(requestOf(body.replace('hard@', 'hare@'), headers), endpoint)).toEqual({ genuine: false, why: 'bad-signature' });
    expect(await r.read(requestOf(body, headersFor(body, NOW_S - 10, other.privateKey)), endpoint)).toEqual({ genuine: false, why: 'bad-signature' });
    expect(await r.read(requestOf(body, { ...headers, [SENDGRID_TIMESTAMP_HEADER]: String(NOW_S - 11) }), endpoint)).toEqual({ genuine: false, why: 'bad-signature' });
    expect(await r.read(requestOf(body, headersFor(body, NOW_S - 16 * 60)), endpoint)).toEqual({ genuine: false, why: 'stale' });
    expect((await r.read(requestOf(body, headers), endpoint)).genuine).toBe(true);
    expect(await r.read(requestOf(body, headers), endpoint)).toEqual({ genuine: false, why: 'replay' });
    // The same signed content under a re-signed (different) signature is still the same call.
    expect(await r.read(requestOf(body, headersFor(body)), endpoint)).toEqual({ genuine: false, why: 'replay' });
  });

  it('takes the key as base64 or PEM, and refuses before a P-256 key is saved', async () => {
    const pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(sendgridKeyOf(pem)).not.toBeNull();
    expect(sendgridKeyOf(VERIFICATION_KEY)).not.toBeNull();
    expect(sendgridKeyOf('not a key')).toBeNull();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(sendgridKeyOf(rsa)).toBeNull();
    const body = fixtureText('sendgrid-events.json');
    expect(await reader().read(requestOf(body, headersFor(body)), endpointFor('sendgrid'))).toEqual({ genuine: false, why: 'not-set-up' });
    expect(await reader().read(requestOf(body, {}), endpoint)).toEqual({ genuine: false, why: 'malformed' });
    const notArray = '{"event":"bounce"}';
    expect(await reader().read(requestOf(notArray, headersFor(notArray)), endpoint)).toEqual({ genuine: false, why: 'malformed' });
  });
});

describe('another service', () => {
  it('takes its documented shape, with the token alone', async () => {
    const verdict = await reader().read(requestOf(fixtureText('other-events.json')), endpointFor('other'));
    expect(verdict).toEqual({
      genuine: true,
      events: [
        { address: 'gone@example.com', kind: 'bounce', permanent: true, relayEventId: 'evt-1', at: Date.parse('2026-10-26T10:00:00Z') },
        { address: 'full@example.com', kind: 'bounce', permanent: false, relayEventId: 'evt-2', at: null },
        { address: 'angry@example.com', kind: 'complaint', permanent: true, relayEventId: null, at: 1793000000000 },
        { address: 'bye@example.com', kind: 'unsubscribe', permanent: true, relayEventId: null, at: null },
      ],
    });
  });

  it('hands on the Message-ID an event names, and refuses one too long', async () => {
    const body = (messageId: string) => JSON.stringify({ events: [{ address: 'gone@example.com', kind: 'bounce', messageId }] });
    expect(await reader().read(requestOf(body('<esnd_01JB2Y7Z5Q3S8T9V0W1X2Y3Z4A@meridian.example>')), endpointFor('other'))).toMatchObject({
      genuine: true,
      events: [{ address: 'gone@example.com', messageId: '<esnd_01JB2Y7Z5Q3S8T9V0W1X2Y3Z4A@meridian.example>' }],
    });
    expect(await reader().read(requestOf(body('x'.repeat(256))), endpointFor('other'))).toEqual({ genuine: false, why: 'malformed' });
  });

  it('checks the credentials when it was given some, and refuses anything off its shape', async () => {
    const endpoint = endpointFor('other', { basic: { user: 'adminium-other', pass: 'kept' } });
    const body = fixtureText('other-events.json');
    expect(await reader().read(requestOf(body), endpoint)).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect((await reader().read(requestOf(body, basicHeader('adminium-other', 'kept')), endpoint)).genuine).toBe(true);
    const bad = (value: unknown) => reader().read(requestOf(JSON.stringify(value)), endpointFor('other'));
    expect(await bad({ events: [] })).toEqual({ genuine: false, why: 'malformed' });
    expect(await bad({ events: [{ address: 'a@example.com', kind: 'opened' }] })).toEqual({ genuine: false, why: 'malformed' });
    expect(await bad({ events: [{ address: 'not an address', kind: 'bounce' }] })).toEqual({ genuine: false, why: 'malformed' });
    expect(await bad({ events: [{ address: 'a@example.com', kind: 'bounce', extra: 1 }] })).toEqual({ genuine: false, why: 'malformed' });
    expect(await bad({ events: Array.from({ length: 1001 }, () => ({ address: 'a@example.com', kind: 'bounce' })) })).toEqual({ genuine: false, why: 'malformed' });
    expect(await reader().read(requestOf(body, {}, 'wrong-token-of-some-length'), endpointFor('other'))).toEqual({ genuine: false, why: 'wrong-token' });
  });
});

describe('the door the route uses', () => {
  it('answers each verdict with the status that makes the service stop or retry', () => {
    const answers = (['wrong-token', 'wrong-credentials', 'not-set-up', 'malformed', 'bad-signature', 'stale', 'replay', 'wrong-topic', 'wrong-host', 'certificate-unavailable', 'handshake-failed'] as const).map((why) => [why, noticeAnswer({ genuine: false, why } as NoticeVerdict)]);
    expect(Object.fromEntries(answers)).toEqual({
      'wrong-token': 401,
      'wrong-credentials': 401,
      'not-set-up': 503,
      malformed: 400,
      'bad-signature': 403,
      stale: 403,
      replay: 200,
      'wrong-topic': 403,
      'wrong-host': 403,
      'certificate-unavailable': 503,
      'handshake-failed': 503,
    });
    expect(noticeAnswer({ genuine: true, events: [] })).toBe(200);
  });

  it('words the bounce card’s secret row per service, and builds the address to paste', () => {
    expect(NOTICE_SERVICES.map((service) => NOTICE_SECRET_ROW[service])).toEqual(['topic-arn', 'copy-credentials', 'signing-key', 'copy-credentials', 'verification-key', 'copy-credentials']);
    expect(noticeAddress('https://crm.meridian.example/', 'postmark', PATH_TOKEN)).toBe(`https://crm.meridian.example/api/v1/email/notices/postmark/${PATH_TOKEN}`);
  });

  it('forgets the oldest call first when full, and lets a call through once its window has passed', () => {
    let now = 0;
    const guard = createReplayGuard({ max: 2, now: () => now });
    expect(guard.claim('a', 100)).toBe(true);
    expect(guard.claim('a', 100)).toBe(false);
    expect(guard.claim('b', 100)).toBe(true);
    expect(guard.claim('c', 100)).toBe(true);
    expect(guard.claim('a', 100)).toBe(true);
    now = 200;
    expect(guard.claim('c', 300)).toBe(true);
    guard.release('c');
    expect(guard.claim('c', 300)).toBe(true);
  });
});
