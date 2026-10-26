// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two signed links a marketing mail can carry, below any database: the
 * unsubscribe token (the address sealed, the purpose and the install
 * signed, no expiry) and a counted click link (an HMAC over the target and
 * the send), which is never an open redirect.
 */
import { describe, expect, it } from 'vitest';

import { clickUrl, readClickLink, signClickLink, withClickLinks } from '../src/email/click-link.js';
import { makeUnsubscribeToken, readUnsubscribeToken, unsubscribeUrl } from '../src/email/unsubscribe-token.js';

const SECRET = 'a-test-secret-of-enough-length-0123456789';

/** Every token with one character changed: none may read. */
function oneByteChanged(token: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < token.length; i += 1) {
    const swap = token[i] === 'A' ? 'B' : 'A';
    out.push(`${token.slice(0, i)}${swap}${token.slice(i + 1)}`);
  }
  return out;
}

describe('the unsubscribe token', () => {
  it('reads back the address, the purpose and the send it was made for, on its own install', () => {
    const token = makeUnsubscribeToken(SECRET, 'install-1', { address: ' Ana.Kovac@CobaltLegal.dev ', purpose: 'newsletter', send: 'esnd_1' });
    expect(readUnsubscribeToken(SECRET, 'install-1', token)).toEqual({ address: 'ana.kovac@cobaltlegal.dev', purpose: 'newsletter', send: 'esnd_1' });
    // A mail on the existing-customers basis has no purpose: its page has the one button.
    const plain = makeUnsubscribeToken(SECRET, 'install-1', { address: 'bo@cobaltlegal.dev', purpose: null });
    expect(readUnsubscribeToken(SECRET, 'install-1', plain)).toEqual({ address: 'bo@cobaltlegal.dev', purpose: null, send: null });
    expect(unsubscribeUrl('https://crm.meridian.example/', token)).toBe(`https://crm.meridian.example/m/u/${token}`);
  });

  it('keeps the address out of sight: sealed, never in clear in the link', () => {
    const token = makeUnsubscribeToken(SECRET, 'install-1', { address: 'ana@cobaltlegal.dev', purpose: 'newsletter' });
    const payload = Buffer.from(token.split('~')[0]!, 'base64url').toString('utf8');
    expect(token).not.toContain('cobaltlegal');
    expect(payload).not.toContain('cobaltlegal');
    expect(token).toMatch(/^[A-Za-z0-9_~-]+$/);
  });

  it('is refused with any one byte changed, from another install, under another secret, or as anything else', () => {
    const token = makeUnsubscribeToken(SECRET, 'install-1', { address: 'ana@cobaltlegal.dev', purpose: 'surveys' });
    for (const changed of oneByteChanged(token)) expect(readUnsubscribeToken(SECRET, 'install-1', changed)).toBeNull();
    expect(readUnsubscribeToken(SECRET, 'install-2', token)).toBeNull();
    expect(readUnsubscribeToken(`${SECRET}-other`, 'install-1', token)).toBeNull();
    expect(readUnsubscribeToken(SECRET, 'install-1', token.split('~')[0])).toBeNull();
    expect(readUnsubscribeToken(SECRET, 'install-1', '')).toBeNull();
    expect(readUnsubscribeToken(SECRET, 'install-1', 42)).toBeNull();
    expect(readUnsubscribeToken(SECRET, 'install-1', `${token}${'x'.repeat(2000)}`)).toBeNull();
  });
});

describe('a counted click link', () => {
  it('goes only where it was signed to, for the send it was signed in', () => {
    const token = signClickLink(SECRET, { target: 'https://meridian.example/autumn?x=1', send: 'esnd_9' })!;
    expect(readClickLink(SECRET, token)).toEqual({ target: 'https://meridian.example/autumn?x=1', send: 'esnd_9' });
    expect(clickUrl('https://crm.meridian.example', token)).toBe(`https://crm.meridian.example/m/l/${token}`);
  });

  it('refuses one byte changed, an unsigned target, and anything that is not a web address', () => {
    const token = signClickLink(SECRET, { target: 'https://meridian.example/autumn', send: 'esnd_9' })!;
    for (const changed of oneByteChanged(token)) expect(readClickLink(SECRET, changed)).toBeNull();
    // A target with no signature, or signed under another secret, is never followed.
    const unsigned = Buffer.from(JSON.stringify({ v: 1, t: 'https://evil.example/', s: 'esnd_9' })).toString('base64url');
    expect(readClickLink(SECRET, unsigned)).toBeNull();
    expect(readClickLink(SECRET, `${unsigned}~${'A'.repeat(43)}`)).toBeNull();
    expect(readClickLink(SECRET, 'https://evil.example/')).toBeNull();
    expect(readClickLink(`${SECRET}-other`, token)).toBeNull();
    for (const target of ['javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.example', 'https://user:pw@meridian.example/', '/relative']) {
      expect(signClickLink(SECRET, { target, send: 'esnd_9' })).toBeNull();
    }
  });

  it('rewrites a mail’s web links, and leaves the unsubscribe link as it is', () => {
    const html = '<a href="https://meridian.example/a?x=1&amp;y=2">A</a> <a href="mailto:hi@meridian.example">M</a> <a href="https://crm.meridian.example/m/u/tok~sig">U</a>';
    const out = withClickLinks(html, { secret: SECRET, origin: 'https://crm.meridian.example', send: 'esnd_3', keep: (href) => href.startsWith('https://crm.meridian.example/m/u/') });
    const links = [...out.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);
    expect(links[0]).toMatch(/^https:\/\/crm\.meridian\.example\/m\/l\//);
    expect(readClickLink(SECRET, links[0]!.slice('https://crm.meridian.example/m/l/'.length))).toEqual({ target: 'https://meridian.example/a?x=1&y=2', send: 'esnd_3' });
    expect(links[1]).toBe('mailto:hi@meridian.example');
    expect(links[2]).toBe('https://crm.meridian.example/m/u/tok~sig');
  });
});
