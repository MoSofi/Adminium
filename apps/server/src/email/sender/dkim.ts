// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium's own DKIM signature on marketing mail: the key, the DNS record
 * the owner publishes, and the options nodemailer signs with.
 *
 * ─── Which headers are signed ──────────────────────────────────────────────
 * nodemailer's default list (`dkim/sign.js` in nodemailer 10.0.10, the
 * version in the lockfile) covers `List-Unsubscribe` but not
 * `List-Unsubscribe-Post`. RFC 8058 §3.1 says both MUST be covered, or
 * Gmail and Yahoo do not show their unsubscribe button. So the list is
 * nodemailer's own plus `List-Unsubscribe-Post`, passed as
 * `headerFieldNames`.
 *
 * ─── Which are not ─────────────────────────────────────────────────────────
 * Amazon SES rewrites `Message-ID` and `Date`, and Postmark replaces
 * `Message-ID` (unless told to keep it), so a signature over them breaks on
 * the way out. `skipFields: 'message-id:date'` leaves them out, as
 * nodemailer's own SES transport does.
 *
 * nodemailer takes `skipFields` as names joined by `:`, and drops a name
 * there from whatever `headerFieldNames` lists (`relaxedHeaders`).
 */
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

import { dkimRecordName } from './dns.js';

const makeKeyPair = promisify(generateKeyPair);

/** The selector the settings screen offers: `adminium._domainkey.<domain>`. */
export const DEFAULT_DKIM_SELECTOR = 'adminium';

/** RSA, 2048 bits: what every receiver takes, and what fits a DNS record a provider's screen accepts. */
export const DKIM_KEY_BITS = 2048;

/** nodemailer's default signed headers (10.0.10, `dkim/sign.js`), then `List-Unsubscribe-Post`. */
export const DKIM_HEADER_FIELDS = [
  'From',
  'Sender',
  'Reply-To',
  'Subject',
  'Date',
  'Message-ID',
  'To',
  'Cc',
  'MIME-Version',
  'Content-Type',
  'Content-Transfer-Encoding',
  'Content-ID',
  'Content-Description',
  'Resent-Date',
  'Resent-From',
  'Resent-Sender',
  'Resent-To',
  'Resent-Cc',
  'Resent-Message-ID',
  'In-Reply-To',
  'References',
  'List-Id',
  'List-Help',
  'List-Unsubscribe',
  'List-Subscribe',
  'List-Post',
  'List-Owner',
  'List-Archive',
  'List-Unsubscribe-Post',
].join(':');

/** The fields relays rewrite, left out of the signature. */
export const DKIM_SKIP_FIELDS = 'message-id:date';

export interface DkimKeyPair {
  /** PKCS#8 PEM: kept encrypted, never shown. */
  privateKey: string;
  /** Base64 of the public key's DER (SPKI): the record's `p=`. */
  publicKey: string;
}

/** A new RSA key for a sending domain. */
export async function generateDkimKey(): Promise<DkimKeyPair> {
  const { privateKey, publicKey } = await makeKeyPair('rsa', {
    modulusLength: DKIM_KEY_BITS,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey: publicKey.toString('base64') };
}

export interface DkimDnsRecord {
  /** `<selector>._domainkey.<domain>`. */
  name: string;
  type: 'TXT';
  /** `v=DKIM1; k=rsa; p=…`. */
  value: string;
  /** The line the screen shows: `<name> TXT "<value>"`. */
  text: string;
}

/** The DNS record that publishes a key. */
export function dkimDnsRecord(domain: string, selector: string, publicKey: string): DkimDnsRecord {
  const name = dkimRecordName(domain, selector);
  const value = `v=DKIM1; k=rsa; p=${publicKey.replace(/\s+/g, '')}`;
  return { name, type: 'TXT', value, text: `${name} TXT "${value}"` };
}

/** What nodemailer's `dkim` option takes (the subset Adminium sets). */
export interface DkimSignOptions {
  domainName: string;
  keySelector: string;
  privateKey: string;
  headerFieldNames: string;
  skipFields: string;
}

/** nodemailer's `dkim` options for a sending domain's key. */
export function dkimSignOptions(input: { domain: string; selector: string; privateKey: string }): DkimSignOptions {
  return {
    domainName: input.domain.trim().toLowerCase().replace(/\.$/, ''),
    keySelector: input.selector,
    privateKey: input.privateKey,
    headerFieldNames: DKIM_HEADER_FIELDS,
    skipFields: DKIM_SKIP_FIELDS,
  };
}
