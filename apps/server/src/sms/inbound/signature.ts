// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Proving that a provider sent a delivery.
 *
 * Twilio: HMAC-SHA1 of the address it was given followed by each form field
 * name and value, sorted, in base64, keyed with the Auth Token. The address is
 * the STORED public address and never one built from the request, because a
 * proxy changes what the server sees. Twilio's own libraries also try the
 * address with and without its port, since the port it signs depends on the
 * connection, so this does the same, on the stored address only. A `#` part
 * (the retry override given to Twilio) is never signed, so it is left out here.
 *
 * Telnyx: Ed25519 over `<timestamp>|<exact body>`, against the account's public
 * key, within five minutes either way.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

/** Telnyx's documented tolerance. */
export const TELNYX_WINDOW_SECONDS = 300;

/** The fixed DER header of an Ed25519 public key; the 32 raw bytes follow it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The address with its port as stored, and the forms of it Twilio may have signed. */
export function twilioAddressForms(address: string): string[] {
  const signed = address.split('#', 1)[0] as string;
  const url = new URL(signed);
  if (url.port !== '') {
    const without = new URL(signed);
    without.port = '';
    return [signed, without.toString()];
  }
  const standard = url.protocol === 'https:' ? '443' : '80';
  return [signed, signed.replace(url.host, `${url.hostname}:${standard}`)];
}

/** The string Twilio signs: the address, then each name and value, names sorted, repeats of a pair once. */
export function twilioSignedText(address: string, form: URLSearchParams): string {
  const names = [...new Set(form.keys())].sort();
  let text = address;
  for (const name of names) {
    for (const value of [...new Set(form.getAll(name))].sort()) text += name + value;
  }
  return text;
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyTwilio(input: { address: string; rawBody: Buffer; signature: unknown; authToken: string }): boolean {
  if (typeof input.signature !== 'string' || input.signature.length === 0 || input.signature.length > 128 || !BASE64.test(input.signature)) return false;
  const given = Buffer.from(input.signature, 'base64');
  const form = new URLSearchParams(input.rawBody.toString('utf8'));
  let matched = false;
  // Every form is computed, so the time taken does not say which one was close.
  for (const address of twilioAddressForms(input.address)) {
    const expected = createHmac('sha1', input.authToken).update(twilioSignedText(address, form), 'utf8').digest();
    if (sameBytes(given, expected)) matched = true;
  }
  return matched;
}

export type TelnyxVerdict = 'genuine' | 'bad-signature' | 'stale';

export function verifyTelnyx(input: { rawBody: Buffer; signature: unknown; timestamp: unknown; publicKey: string; now: number }): TelnyxVerdict {
  if (typeof input.timestamp !== 'string' || !/^\d{1,12}$/.test(input.timestamp)) return 'bad-signature';
  if (typeof input.signature !== 'string' || input.signature.length > 128 || !BASE64.test(input.signature)) return 'bad-signature';
  const signature = Buffer.from(input.signature, 'base64');
  const raw = Buffer.from(input.publicKey, 'base64');
  if (raw.length !== 32) return 'bad-signature';

  let valid: boolean;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    valid = verify(null, Buffer.concat([Buffer.from(`${input.timestamp}|`, 'utf8'), input.rawBody]), key, signature);
  } catch {
    return 'bad-signature';
  }
  if (!valid) return 'bad-signature';
  // Judged after the signature, so an unsigned caller learns nothing about the clock.
  return Math.abs(input.now / 1000 - Number(input.timestamp)) > TELNYX_WINDOW_SECONDS ? 'stale' : 'genuine';
}
