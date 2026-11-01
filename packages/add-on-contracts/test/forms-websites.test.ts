// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Your websites": the one check every line of the add box is held to, by
 * the Privacy page as it is typed and by the server on save. Its order, its
 * reduction of a line to an origin, a batch that names one site twice, and
 * its own entry (`./forms/websites`), which reaches nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WEBSITES_MAX, checkWebsiteLine, checkWebsiteLines, isWebsiteOrigin } from '../src/forms/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { self: 'https://crm.meridian.example', listed: ['https://www.meridian.example'] };
const code = (line: string) => checkWebsiteLine(line, ctx).code;

describe('one line of "Your websites"', () => {
  it('refuses a blank line, a space, a comma or a star first', () => {
    for (const line of ['', '   ', 'https://a.example https://b.example', 'https://a.example,https://b.example', 'https://*.meridian.example', '*', 'http://a.example b']) {
      expect(code(line), JSON.stringify(line)).toBe('one-per-line');
    }
  });

  it('then asks for https', () => {
    for (const line of ['http://events.meridian.example', 'events.meridian.example', 'ftp://events.meridian.example', '//events.meridian.example']) expect(code(line), line).toBe('https');
  });

  it('then refuses what is no address, and a path, a query or a fragment', () => {
    for (const line of ['https://', 'https://user:pw@shop.example', `https://${'a'.repeat(260)}.example`]) expect(code(line), line).toBe('address');
    for (const line of ['https://shop.example/forms', 'https://shop.example/?', 'https://shop.example/?a=1', 'https://shop.example#top', 'https://shop.example//']) expect(code(line), line).toBe('path');
  });

  it('then refuses this server’s own address, however it is written', () => {
    for (const line of ['https://crm.meridian.example', 'HTTPS://CRM.Meridian.Example/', 'https://crm.meridian.example:443']) expect(code(line), line).toBe('self');
    // No public address set: nothing is "this server".
    expect(checkWebsiteLine('https://crm.meridian.example', { self: null, listed: [] }).code).toBe('ok');
  });

  it('then refuses a website already listed', () => {
    expect(code('https://WWW.meridian.example/')).toBe('listed');
  });

  it('reduces a good line to its origin: lower case, no trailing slash, no default port', () => {
    expect(checkWebsiteLine('  HTTPS://Shop.Meridian.Example:443/  ', ctx)).toEqual({ line: '  HTTPS://Shop.Meridian.Example:443/  ', code: 'ok', origin: 'https://shop.meridian.example' });
    expect(checkWebsiteLine('https://shop.meridian.example:8443', ctx).origin).toBe('https://shop.meridian.example:8443');
    expect(checkWebsiteLine('https://bücher.example', ctx).origin).toBe('https://xn--bcher-kva.example');
  });

  it('keeps the comp’s sample to its four refusals', () => {
    const lines = ['http://events.meridian.example', 'https://*.meridian.example', 'https://crm.meridian.example', 'https://www.meridian.example'];
    expect(checkWebsiteLines(lines, ctx).map((one) => one.code)).toEqual(['https', 'one-per-line', 'self', 'listed']);
  });
});

describe('a batch', () => {
  it('names a site twice only once: the second line is already on the list', () => {
    const checked = checkWebsiteLines(['https://shop.example', 'https://SHOP.example/'], { self: null, listed: [] });
    expect(checked.map((one) => [one.code, one.origin])).toEqual([
      ['ok', 'https://shop.example'],
      ['listed', 'https://shop.example'],
    ]);
  });

  it('holds at most fifty websites', () => {
    expect(WEBSITES_MAX).toBe(50);
  });
});

describe('a stored origin', () => {
  it('is exactly what a good line reduces to', () => {
    expect(isWebsiteOrigin('https://shop.example')).toBe(true);
    expect(isWebsiteOrigin('https://shop.example:8443')).toBe(true);
    for (const value of ['https://shop.example/', 'https://SHOP.example', 'http://shop.example', 'https://shop.example/a', 'shop.example']) expect(isWebsiteOrigin(value), value).toBe(false);
  });
});

describe('its own entry', () => {
  it('is published as ./forms/websites and imports nothing', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { exports: Record<string, { default: string; types: string }> };
    expect(pkg.exports['./forms/websites']).toEqual({ types: './dist/forms/websites.d.ts', default: './dist/forms/websites.js' });
    expect(readFileSync(join(here, '..', 'src', 'forms', 'websites.ts'), 'utf8')).not.toMatch(/^import /m);
  });
});
