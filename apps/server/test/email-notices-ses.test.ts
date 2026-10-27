// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Amazon SES through SNS: the signed message, the pinned topic and host, the
 * handshake, and SES's own notice inside `Message`.
 *
 * SNS's certificate is stood in for by one made here, served by a fake fetch
 * that counts its calls, so the tests can prove a forged address is refused
 * WITHOUT a fetch.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createNoticeReader, createReplayGuard, noticeAnswer, type NoticeVerdict } from '../src/email/notices/index.js';
import { snsStringToSign } from '../src/email/notices/ses.js';
import { basicHeader, endpointFor, fixture, PATH_TOKEN, requestOf, selfSignedCertificate } from './relay-notice-helpers.js';

const TOPIC = 'arn:aws:sns:us-west-2:123456789012:MyTopic';
const CERT_URL = 'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-f3ecfb7224c7233fe7bb5f59f96de52f.pem';
const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const DAY = 86_400_000;

const sns = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT = selfSignedCertificate({ ...sns, commonName: 'sns.amazonaws.com', notBefore: NOW - 30 * DAY, notAfter: NOW + 300 * DAY });

/** A fetch standing in for SNS: the certificate at its address, a 200 at the subscribe address. Counts every call. */
function fakeSns(cert = CERT) {
  const calls: string[] = [];
  const fetch = async (url: string): Promise<Buffer> => {
    calls.push(url);
    if (url === CERT_URL) return Buffer.from(cert, 'utf8');
    if (url.includes('Action=ConfirmSubscription')) return Buffer.from('<ConfirmSubscriptionResponse/>');
    throw new Error(`unexpected fetch ${url}`);
  };
  return { calls, fetch };
}

/** Sign an SNS message as SNS does, with the version's hash. */
function signed(message: Record<string, unknown>, key = sns.privateKey): Record<string, unknown> {
  const version = message['SignatureVersion'] === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  const text = snsStringToSign(message);
  if (text === null) throw new Error('not signable');
  return { ...message, Signature: createSign(version).update(text, 'utf8').sign(key, 'base64') };
}

function notification(notice: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  const base = fixture('sns-notification.json');
  return { ...base, Message: JSON.stringify(notice), Timestamp: new Date(NOW - 60_000).toISOString(), ...over };
}

function confirmation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...fixture('sns-subscription-confirmation.json'), Timestamp: new Date(NOW - 60_000).toISOString(), ...over };
}

function setup(over: { now?: number; cert?: string } = {}) {
  const fake = fakeSns(over.cert);
  const reader = createNoticeReader({ now: () => over.now ?? NOW, snsFetch: fake.fetch, replays: createReplayGuard({ now: () => over.now ?? NOW }) });
  const endpoint = endpointFor('ses', { topicArn: TOPIC });
  const read = (message: Record<string, unknown>, headers: Record<string, string> = { 'x-amz-sns-message-type': String(message['Type']) }, token = PATH_TOKEN): Promise<NoticeVerdict> =>
    reader.read(requestOf(JSON.stringify(message), { 'content-type': 'text/plain; charset=UTF-8', ...headers }, token), endpoint);
  return { fake, reader, endpoint, read };
}

describe('Amazon SES notices through SNS', () => {
  it('takes the documented bounce: every recipient, permanent, with its feedback id and time', async () => {
    const { read } = setup();
    const verdict = await read(signed(notification(fixture('ses-bounce.json'))));
    expect(verdict).toEqual({
      genuine: true,
      events: [
        // `commonHeaders.messageId` is the Message-ID the mail left with: a campaign mail's names its send-log row.
        { address: 'jane@example.com', kind: 'bounce', permanent: true, relayEventId: '000001378603177f-7a5433e7-8edb-42ae-af10-f0181f34d6ee-000000', at: Date.parse('2016-01-27T14:59:38.237Z'), messageId: 'custom-message-ID' },
        { address: 'richard@example.com', kind: 'bounce', permanent: true, relayEventId: '000001378603177f-7a5433e7-8edb-42ae-af10-f0181f34d6ee-000000', at: Date.parse('2016-01-27T14:59:38.237Z'), messageId: 'custom-message-ID' },
      ],
    });
    expect(noticeAnswer(verdict)).toBe(200);
  });

  it('takes a complaint, signed with SignatureVersion 2', async () => {
    const { read } = setup();
    const verdict = await read(signed(notification(fixture('ses-complaint.json'), { SignatureVersion: '2' })));
    expect(verdict).toMatchObject({ genuine: true, events: [{ address: 'richard@example.com', kind: 'complaint', permanent: true }] });
  });

  it('keeps a Transient bounce (an out-of-office reply) off the list, and reads event publishing’s eventType', async () => {
    const { read } = setup();
    const base = fixture<{ bounce: Record<string, unknown> }>('ses-bounce.json');
    const soft = { ...base, notificationType: undefined, eventType: 'Bounce', bounce: { ...base.bounce, bounceType: 'Transient' } };
    const verdict = await read(signed(notification(soft)));
    expect(verdict.genuine && verdict.events.map((e) => [e.address, e.permanent])).toEqual([
      ['jane@example.com', false],
      ['richard@example.com', false],
    ]);
    // A delivery is genuine and carries nothing for the list.
    const delivery = await read(signed(notification({ notificationType: 'Delivery', delivery: {}, mail: {} }, { MessageId: 'delivery-1' })));
    expect(delivery).toEqual({ genuine: true, events: [] });
  });

  it('refuses the same body with one byte changed', async () => {
    const { read } = setup();
    const message = signed(notification(fixture('ses-bounce.json')));
    const changed = { ...message, Message: String(message['Message']).replace('jane@', 'jand@') };
    expect(await read(changed)).toEqual({ genuine: false, why: 'bad-signature' });
  });

  it('refuses a message signed with another key', async () => {
    const { read } = setup();
    expect(await read(signed(notification(fixture('ses-bounce.json')), stranger.privateKey))).toEqual({ genuine: false, why: 'bad-signature' });
  });

  it('refuses a stale message, and one dated in the future', async () => {
    const { read, fake } = setup();
    expect(await read(signed(notification(fixture('ses-bounce.json'), { Timestamp: new Date(NOW - 2 * 3_600_000).toISOString() })))).toEqual({ genuine: false, why: 'stale' });
    expect(await read(signed(notification(fixture('ses-bounce.json'), { Timestamp: new Date(NOW + 3_600_000).toISOString() })))).toEqual({ genuine: false, why: 'stale' });
    expect(fake.calls).toEqual([]);
  });

  it('refuses a replay of a message already taken', async () => {
    const { read } = setup();
    const message = signed(notification(fixture('ses-bounce.json')));
    expect((await read(message)).genuine).toBe(true);
    const again = await read(message);
    expect(again).toEqual({ genuine: false, why: 'replay' });
    expect(noticeAnswer(again)).toBe(200);
  });

  it('refuses a topic other than the pinned one, before fetching anything', async () => {
    const { read, fake } = setup();
    const other = signed(notification(fixture('ses-bounce.json'), { TopicArn: 'arn:aws:sns:us-west-2:123456789012:OtherTopic' }));
    expect(await read(other)).toEqual({ genuine: false, why: 'wrong-topic' });
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ['another host', 'https://attacker.example/SimpleNotificationService-f3.pem'],
    ['a look-alike host', 'https://sns.us-west-2.amazonaws.com.attacker.example/x.pem'],
    ['another region', 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-f3.pem'],
    ['plain http', 'http://sns.us-west-2.amazonaws.com/SimpleNotificationService-f3.pem'],
    ['another port', 'https://sns.us-west-2.amazonaws.com:8443/SimpleNotificationService-f3.pem'],
    ['credentials', 'https://user@sns.us-west-2.amazonaws.com/SimpleNotificationService-f3.pem'],
    ['not a certificate', 'https://sns.us-west-2.amazonaws.com/?Action=Anything'],
    ['the China partition', 'https://sns.cn-north-1.amazonaws.com.cn/SimpleNotificationService-f3.pem'],
  ])('refuses a SigningCertURL on %s WITHOUT a fetch', async (_label, url) => {
    const { read, fake } = setup();
    expect(await read(signed(notification(fixture('ses-bounce.json'), { SigningCertURL: url })))).toEqual({ genuine: false, why: 'wrong-host' });
    expect(fake.calls).toEqual([]);
  });

  it('refuses a SubscribeURL on another host WITHOUT a fetch, even when everything else is genuine', async () => {
    const { read, fake } = setup();
    const forged = signed(confirmation({ SubscribeURL: 'https://169.254.169.254/latest/meta-data/' }));
    const verdict = await read(forged);
    expect(verdict).toEqual({ genuine: false, why: 'wrong-host' });
    expect(fake.calls).toEqual([]);
  });

  it('answers the handshake: fetches the subscribe address once, after the signature, and never for a replay', async () => {
    const { read, fake } = setup();
    const message = signed(confirmation());
    expect(await read(message)).toEqual({ genuine: true, events: [], reply: { kind: 'subscription-confirmed' } });
    expect(fake.calls).toEqual([CERT_URL, String(message['SubscribeURL'])]);
    expect(await read(message)).toEqual({ genuine: false, why: 'replay' });
    expect(fake.calls).toHaveLength(2);
    // A forged confirmation (wrong key) fetches the certificate (cached) and never the subscribe address.
    expect(await read(signed(confirmation({ MessageId: 'forged' }), stranger.privateKey))).toEqual({ genuine: false, why: 'bad-signature' });
    expect(fake.calls).toHaveLength(2);
  });

  it('takes the service’s retry when the handshake could not be answered', async () => {
    let fail = true;
    const calls: string[] = [];
    const reader = createNoticeReader({
      now: () => NOW,
      snsFetch: async (url) => {
        calls.push(url);
        if (url === CERT_URL) return Buffer.from(CERT);
        if (fail) throw new Error('timed out');
        return Buffer.from('ok');
      },
    });
    const endpoint = endpointFor('ses', { topicArn: TOPIC });
    const body = JSON.stringify(signed(confirmation()));
    const first = await reader.read(requestOf(body), endpoint);
    expect(first).toEqual({ genuine: false, why: 'handshake-failed' });
    expect(noticeAnswer(first)).toBe(503);
    fail = false;
    expect(await reader.read(requestOf(body), endpoint)).toMatchObject({ genuine: true, reply: { kind: 'subscription-confirmed' } });
  });

  it('says when SNS removed the subscription', async () => {
    const { read } = setup();
    const message = signed(confirmation({ Type: 'UnsubscribeConfirmation', MessageId: 'unsub-1' }));
    expect(await read(message)).toEqual({ genuine: true, events: [], reply: { kind: 'unsubscribed' } });
  });

  it('uses a fetched certificate again, and refuses one outside its own dates', async () => {
    const { read, fake } = setup();
    await read(signed(notification(fixture('ses-bounce.json'), { MessageId: 'a' })));
    await read(signed(notification(fixture('ses-complaint.json'), { MessageId: 'b' })));
    expect(fake.calls).toEqual([CERT_URL]);

    const expired = selfSignedCertificate({ ...sns, commonName: 'sns.amazonaws.com', notBefore: NOW - 300 * DAY, notAfter: NOW - DAY });
    const old = setup({ cert: expired });
    const verdict = await old.read(signed(notification(fixture('ses-bounce.json'))));
    expect(verdict).toEqual({ genuine: false, why: 'certificate-unavailable' });
    expect(noticeAnswer(verdict)).toBe(503);
    const junk = setup({ cert: 'not a certificate' });
    expect(await junk.read(signed(notification(fixture('ses-bounce.json'))))).toEqual({ genuine: false, why: 'certificate-unavailable' });
  });

  it('refuses a wrong path token, and checks the basic credentials when some are kept', async () => {
    const { read, reader } = setup();
    const message = signed(notification(fixture('ses-bounce.json')));
    expect(await read(message, {}, `${PATH_TOKEN}x`)).toEqual({ genuine: false, why: 'wrong-token' });
    const withBasic = endpointFor('ses', { topicArn: TOPIC, basic: { user: 'adminium-ses', pass: 'kept-pass' } });
    expect(await reader.read(requestOf(JSON.stringify(message), basicHeader('adminium-ses', 'wrong')), withBasic)).toEqual({ genuine: false, why: 'wrong-credentials' });
    expect((await reader.read(requestOf(JSON.stringify(message), basicHeader('adminium-ses', 'kept-pass')), withBasic)).genuine).toBe(true);
  });

  it('refuses before setup, and what is not an SNS message', async () => {
    const { reader, read } = setup();
    const message = signed(notification(fixture('ses-bounce.json')));
    const unset = await reader.read(requestOf(JSON.stringify(message)), endpointFor('ses'));
    expect(unset).toEqual({ genuine: false, why: 'not-set-up' });
    expect(noticeAnswer(unset)).toBe(503);
    // Raw message delivery: the SES notice with no SNS envelope, so nothing signed.
    expect(await read(fixture('ses-bounce.json'))).toEqual({ genuine: false, why: 'malformed' });
    expect(await reader.read(requestOf('not json'), endpointFor('ses', { topicArn: TOPIC }))).toEqual({ genuine: false, why: 'malformed' });
    // The header must agree with the body.
    expect(await read(message, { 'x-amz-sns-message-type': 'SubscriptionConfirmation' })).toEqual({ genuine: false, why: 'malformed' });
    expect(await read({ ...message, SignatureVersion: '3' })).toEqual({ genuine: false, why: 'malformed' });
  });
});
