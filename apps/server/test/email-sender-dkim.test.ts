// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium's DKIM signature: a key made, the record the screen shows, and a
 * real nodemailer send (stream transport, nothing leaves the process) whose
 * signature covers BOTH one-click unsubscribe headers, leaves out the fields
 * relays rewrite, and verifies against the published key. Then the keys'
 * encrypted store on every engine.
 */
import { createHash, createPublicKey, createVerify } from 'node:crypto';

import { createTransport } from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDkimKeys, DkimKeyError, DKIM_HEADER_FIELDS, dkimDnsRecord, dkimSignOptions, generateDkimKey, type DkimSignOptions } from '../src/email/sender/index.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

/** A message as nodemailer wrote it, signed with `dkim`. */
async function sendSigned(dkim: DkimSignOptions | Record<string, unknown>): Promise<string> {
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'windows', dkim: dkim as DkimSignOptions });
  const info = await transport.sendMail({
    from: 'Meridian <news@meridian.example>',
    to: 'ana@example.com',
    subject: 'Autumn news',
    text: 'Hello  there \r\nsecond line\r\n\r\n',
    html: '<p>Hello there</p>',
    headers: {
      'List-Unsubscribe': '<https://crm.meridian.example/m/u/abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  return (info.message as Buffer).toString('utf8');
}

interface Header {
  name: string;
  line: string;
}

function headersOf(message: string): { headers: Header[]; body: string } {
  const split = message.indexOf('\r\n\r\n');
  const head = message.slice(0, split);
  const headers: Header[] = [];
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line) && headers.length > 0) (headers[headers.length - 1] as Header).line += `\r\n${line}`;
    else headers.push({ name: line.slice(0, line.indexOf(':')).trim().toLowerCase(), line });
  }
  return { headers, body: message.slice(split + 4) };
}

/** Relaxed header canonicalisation (RFC 6376 §3.4.2). */
const relaxedHeader = (header: Header): string =>
  `${header.name}:${header.line
    .slice(header.line.indexOf(':') + 1)
    .replace(/\r\n/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()}`;

/** Relaxed body canonicalisation (RFC 6376 §3.4.4). */
function relaxedBody(body: string): string {
  const lines = body.split('\r\n').map((line) => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length === 0 ? '' : `${lines.join('\r\n')}\r\n`;
}

/** The signature's tags, and whether it verifies against `publicKey` (base64 SPKI): an independent DKIM verifier. */
function verifyDkim(message: string, publicKey: string): { tags: Map<string, string>; bodyOk: boolean; signatureOk: boolean } {
  const { headers, body } = headersOf(message);
  const signature = headers.find((h) => h.name === 'dkim-signature');
  if (signature === undefined) throw new Error('no DKIM-Signature');
  const value = signature.line.slice(signature.line.indexOf(':') + 1).replace(/\r\n[ \t]*/g, '');
  const tags = new Map(value.split(';').map((part) => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).trim().replace(/\s+/g, '')] as [string, string]));
  const bodyOk = createHash('sha256').update(relaxedBody(body)).digest('base64') === tags.get('bh');
  const used = new Set<Header>();
  const lines: string[] = [];
  for (const name of (tags.get('h') ?? '').split(':')) {
    const header = [...headers].reverse().find((h) => h.name === name && !used.has(h) && h !== signature);
    if (header === undefined) continue;
    used.add(header);
    lines.push(`${relaxedHeader(header)}\r\n`);
  }
  const unsigned = { name: 'dkim-signature', line: signature.line.replace(/(\bb=)[^;]*$/, '$1') };
  const data = lines.join('') + relaxedHeader(unsigned);
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  const signatureOk = createVerify('RSA-SHA256').update(data).verify(key, tags.get('b') ?? '', 'base64');
  return { tags, bodyOk, signatureOk };
}

describe('DKIM signing', () => {
  let pair: Awaited<ReturnType<typeof generateDkimKey>>;
  beforeAll(async () => {
    pair = await generateDkimKey();
  });

  it('makes a 2048-bit RSA key and the record the screen shows', () => {
    const key = createPublicKey({ key: Buffer.from(pair.publicKey, 'base64'), format: 'der', type: 'spki' });
    expect(key.asymmetricKeyType).toBe('rsa');
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(pair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    const record = dkimDnsRecord('Meridian.Example', 'adminium', pair.publicKey);
    expect(record).toEqual({
      name: 'adminium._domainkey.meridian.example',
      type: 'TXT',
      value: `v=DKIM1; k=rsa; p=${pair.publicKey}`,
      text: `adminium._domainkey.meridian.example TXT "v=DKIM1; k=rsa; p=${pair.publicKey}"`,
    });
  });

  it('signs a real send so the signature covers both unsubscribe headers, leaves out Date and Message-ID, and verifies', async () => {
    const message = await sendSigned(dkimSignOptions({ domain: 'meridian.example', selector: 'adminium', privateKey: pair.privateKey }));
    const { tags, bodyOk, signatureOk } = verifyDkim(message, pair.publicKey);
    const signed = (tags.get('h') ?? '').split(':');
    expect(signed).toContain('list-unsubscribe');
    expect(signed).toContain('list-unsubscribe-post');
    expect(signed).toContain('from');
    expect(signed).toContain('subject');
    expect(signed).not.toContain('date');
    expect(signed).not.toContain('message-id');
    expect(tags.get('d')).toBe('meridian.example');
    expect(tags.get('s')).toBe('adminium');
    expect(tags.get('a')).toBe('rsa-sha256');
    expect(bodyOk).toBe(true);
    expect(signatureOk).toBe(true);
    // The verifier is real: the same message with its subject changed does not verify.
    expect(verifyDkim(message.replace('Subject: Autumn news', 'Subject: Autumn newz'), pair.publicKey).signatureOk).toBe(false);
  });

  it('is needed: nodemailer’s own header list leaves List-Unsubscribe-Post unsigned, and signs Date and Message-ID', async () => {
    const message = await sendSigned({ domainName: 'meridian.example', keySelector: 'adminium', privateKey: pair.privateKey });
    const signed = (verifyDkim(message, pair.publicKey).tags.get('h') ?? '').split(':');
    expect(signed).toContain('list-unsubscribe');
    expect(signed).not.toContain('list-unsubscribe-post');
    expect(signed).toContain('date');
    expect(signed).toContain('message-id');
    expect(DKIM_HEADER_FIELDS.split(':').at(-1)).toBe('List-Unsubscribe-Post');
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`DKIM keys [${engine.name}]`, () => {
    let handle: MetaHandle;
    beforeAll(async () => {
      handle = await engine.make();
    });
    afterAll(async () => {
      await handle.destroy();
    });
    const SECRET = 'a-test-secret-of-adequate-length-0123456789';
    const keys = (secret = SECRET) => createDkimKeys({ meta: handle.meta, secret, now: () => 1_793_000_000_000 });

    it('makes a key per domain, keeps the private key only encrypted, and signs with it', async () => {
      const made = await keys().make('Meridian.example.');
      expect(made).toMatchObject({ domain: 'meridian.example', selector: 'adminium', createdAt: 1_793_000_000_000 });
      expect(made.record.name).toBe('adminium._domainkey.meridian.example');
      expect(made).not.toHaveProperty('privateKey');

      const raw = JSON.stringify(await handle.meta.db.selectFrom('adminium_email_dkim_keys').selectAll().execute());
      expect(raw).not.toContain('PRIVATE KEY');
      expect(raw).toContain(made.publicKey);

      const options = await keys().signingOptionsFor('meridian.example');
      expect(options).toMatchObject({ domainName: 'meridian.example', keySelector: 'adminium', skipFields: 'message-id:date' });
      const message = await sendSigned(options!);
      expect(verifyDkim(message, made.publicKey).signatureOk).toBe(true);

      expect((await keys().forDomain('MERIDIAN.example'))?.id).toBe(made.id);
      expect(await keys().signingOptionsFor('other.example')).toBeNull();
      await expect(keys().make('meridian.example')).rejects.toMatchObject({ code: 'exists' });
    });

    it('refuses what is not a domain or a selector', async () => {
      await expect(keys().make('not a domain')).rejects.toBeInstanceOf(DkimKeyError);
      await expect(keys().make('-bad.example')).rejects.toMatchObject({ code: 'invalid-domain' });
      await expect(keys().make('ok.example', { selector: 'bad_selector' })).rejects.toMatchObject({ code: 'invalid-selector' });
    });

    it('signs nothing with a key kept under another ADMINIUM_SECRET', async () => {
      expect(await keys('another-secret-of-adequate-length-987654321').signingOptionsFor('meridian.example')).toBeNull();
      expect((await keys('another-secret-of-adequate-length-987654321').forDomain('meridian.example'))?.domain).toBe('meridian.example');
      const second = await keys().make('meridian.example', { selector: 'adminium2' });
      expect((await keys().list()).map((key) => key.selector)).toEqual(['adminium', 'adminium2']);
      expect(await keys().remove(second.id)).toBe(true);
    });
  });
}
