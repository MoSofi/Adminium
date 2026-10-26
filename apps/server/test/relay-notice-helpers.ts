// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Helpers for the mail services' notice tests: the fixtures, a request and an
 * endpoint, and a self-signed certificate standing in for Amazon SNS's.
 *
 * The fixtures (`fixtures/relay-notices/`) are modelled on each service's
 * documented example, with the addresses changed to example.com ones:
 *   - SES: https://docs.aws.amazon.com/ses/latest/dg/notification-examples.html
 *   - SNS: https://docs.aws.amazon.com/sns/latest/dg/http-notification-json.html and
 *     https://docs.aws.amazon.com/sns/latest/dg/http-subscription-confirmation-json.html
 *   - Postmark: https://postmarkapp.com/developer/webhooks/bounce-webhook,
 *     …/spam-complaint-webhook, …/subscription-change-webhook
 *   - Brevo: https://developers.brevo.com/docs/transactional-webhooks
 *   - Mailgun: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhook-payloads
 *   - SendGrid: https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event
 * Every signature in them is a placeholder: the tests sign with keys they make.
 * Nothing is fetched from the network.
 */
import { createHash, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { NoticeEndpointConfig, NoticeRequest, NoticeService } from '../src/email/notices/index.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/relay-notices/', import.meta.url));

/** A fixture's text. */
export function fixtureText(name: string): string {
  return readFileSync(`${FIXTURES}${name}`, 'utf8');
}

/** A fixture, parsed. */
export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export const PATH_TOKEN = 'Qm9vbmNlcy1hcmUtbWFpbC1zZXJ2aWNlLWNhbGxzLXRva2Vu';

export function endpointFor(service: NoticeService, over: Partial<NoticeEndpointConfig> = {}): NoticeEndpointConfig {
  return {
    service,
    tokenHash: createHash('sha256').update(PATH_TOKEN).digest('hex'),
    basic: null,
    signingKey: null,
    verificationKey: null,
    topicArn: null,
    ...over,
  };
}

export function requestOf(body: string | Buffer, headers: Record<string, string> = {}, pathToken = PATH_TOKEN): NoticeRequest {
  return { body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), pathToken };
}

export function basicHeader(user: string, pass: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

// ─── A self-signed X.509 certificate, in DER by hand ─────────────────────────
// Node can read a certificate but not make one, and no certificate library is a
// dependency here. A version-3 certificate without extensions is a few nested
// sequences, so it is written out directly.

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));

function derInteger(value: Buffer): Buffer {
  const body = (value[0] as number) & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  return tlv(0x02, body);
}

function derOid(oid: string): Buffer {
  const [first, second, ...rest] = oid.split('.').map(Number) as [number, number, ...number[]];
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const chunk: number[] = [];
    let n = part;
    do {
      chunk.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) chunk[i] = (chunk[i] as number) | 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function derUtcTime(ms: number): Buffer {
  const iso = new Date(ms).toISOString();
  const text = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

const SHA256_WITH_RSA = seq(derOid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));

/** A self-signed certificate for `publicKey`, as PEM. */
export function selfSignedCertificate(input: { privateKey: KeyObject; publicKey: KeyObject; commonName: string; notBefore: number; notAfter: number }): string {
  const name = seq(tlv(0x31, seq(derOid('2.5.4.3'), tlv(0x0c, Buffer.from(input.commonName, 'utf8')))));
  const spki = input.publicKey.export({ type: 'spki', format: 'der' });
  const tbs = seq(
    tlv(0xa0, derInteger(Buffer.from([2]))),
    derInteger(Buffer.from('0a1b2c3d4e5f', 'hex')),
    SHA256_WITH_RSA,
    name,
    seq(derUtcTime(input.notBefore), derUtcTime(input.notAfter)),
    name,
    spki,
  );
  const signature = sign('sha256', tbs, input.privateKey);
  const der = seq(tbs, SHA256_WITH_RSA, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}
