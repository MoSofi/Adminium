// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site's robots.txt, read as RFC 9309 says, for the website reader: which group is this reader's, which rule
 * wins, and how long a host's rules are kept.
 */
import { describe, expect, it } from 'vitest';

import { createRobotsCache, parseRobots, robotsAllows, ROBOTS_KEEP_MS } from '../src/net/robots.js';

const allows = (text: string, path: string): boolean => robotsAllows(parseRobots(text), path);

describe('the group for this reader', () => {
  it('is the one naming Adminium, without regard to case, else the one for everyone', () => {
    const text = ['User-agent: *', 'Disallow: /', '', 'User-agent: adminium', 'Allow: /'].join('\n');
    expect(allows(text, '/')).toBe(true);
    expect(allows(['User-agent: *', 'Disallow: /'].join('\n'), '/')).toBe(false);
    // The full product token names it too; a name that only starts the same does not.
    expect(allows(['User-agent: *', 'Disallow: /', 'User-agent: Adminium-LeadFinder/1.0', 'Allow: /'].join('\n'), '/a')).toBe(true);
    expect(allows(['User-agent: *', 'Disallow: /', 'User-agent: AdminiumBot', 'Allow: /'].join('\n'), '/a')).toBe(false);
  });

  it('when named, is the named group alone: the rules for everyone no longer apply', () => {
    const text = ['User-agent: *', 'Disallow: /private', 'User-agent: Adminium', 'Disallow: /drafts'].join('\n');
    expect(allows(text, '/private/x')).toBe(true);
    expect(allows(text, '/drafts/x')).toBe(false);
  });

  it('reads several user-agent lines as one group, and two groups for one name as one', () => {
    const text = ['User-agent: other', 'User-agent: Adminium', 'Disallow: /a', '', 'User-agent: Adminium', 'Disallow: /b', 'User-agent: other2', 'Disallow: /c'].join('\n');
    expect(allows(text, '/a')).toBe(false);
    expect(allows(text, '/b')).toBe(false);
    expect(allows(text, '/c')).toBe(true);
  });

  it('ignores rules before any user-agent line, comments, and lines it does not know', () => {
    const text = ['Disallow: /', '# User-agent: *', 'Sitemap: https://kestrel.example/sitemap.xml', 'Crawl-delay: 10', 'User-agent: *', 'Disallow: /x # not this part'].join('\n');
    expect(allows(text, '/')).toBe(true);
    expect(allows(text, '/x')).toBe(false);
  });

  it('allows everything with no file content, and an empty Disallow disallows nothing', () => {
    expect(allows('', '/anything')).toBe(true);
    expect(allows(['User-agent: *', 'Disallow:'].join('\n'), '/anything')).toBe(true);
  });
});

describe('the rule that wins', () => {
  it('is the longest match; an allow and a disallow of one length is an allow', () => {
    const text = ['User-agent: *', 'Disallow: /shop', 'Allow: /shop/about', 'Disallow: /page', 'Allow: /page'].join('\n');
    expect(allows(text, '/shop/cart')).toBe(false);
    expect(allows(text, '/shop/about/team')).toBe(true);
    expect(allows(text, '/page')).toBe(true);
  });

  it('reads * as any run of characters and a final $ as the end', () => {
    const text = ['User-agent: *', 'Disallow: /*.pdf$', 'Disallow: /*/print', 'Disallow: /exact$'].join('\n');
    expect(allows(text, '/files/brochure.pdf')).toBe(false);
    expect(allows(text, '/files/brochure.pdf?x=1')).toBe(true);
    expect(allows(text, '/en/print/1')).toBe(false);
    expect(allows(text, '/exact')).toBe(false);
    expect(allows(text, '/exact/more')).toBe(true);
  });

  it('judges the query too, and compares percent-escapes in either case', () => {
    expect(allows(['User-agent: *', 'Disallow: /?s='].join('\n'), '/?s=lamps')).toBe(false);
    expect(allows(['User-agent: *', 'Disallow: /caf%c3%a9'].join('\n'), '/caf%C3%A9')).toBe(false);
    expect(allows(['User-agent: *', 'Disallow: /café'].join('\n'), '/caf%C3%A9')).toBe(false);
  });

  it('always allows /robots.txt itself', () => {
    expect(allows(['User-agent: *', 'Disallow: /'].join('\n'), '/robots.txt')).toBe(true);
  });

  it('answers quickly a rule written to make a matcher backtrack', () => {
    const text = ['User-agent: *', `Disallow: /${'*a'.repeat(200)}$`].join('\n');
    const began = performance.now();
    expect(allows(text, `/${'a'.repeat(3000)}b`)).toBe(true);
    expect(performance.now() - began).toBeLessThan(2000);
  });
});

describe('the cache', () => {
  it('keeps a host’s rules for at most a day', () => {
    let now = 1_000;
    const cache = createRobotsCache({ now: () => now });
    cache.set('https://kestrel.example', { rules: [] });
    now += ROBOTS_KEEP_MS - 1;
    expect(cache.get('https://kestrel.example')).not.toBeNull();
    now += 1;
    expect(cache.get('https://kestrel.example')).toBeNull();
  });

  it('is bounded in hosts and in size: the oldest goes first, and rules too large are not kept', () => {
    const cache = createRobotsCache({ now: () => 0, maxHosts: 2, maxSize: 10_000 });
    cache.set('https://a.example', { rules: [] });
    cache.set('https://b.example', { rules: [] });
    cache.set('https://c.example', { rules: [] });
    expect(cache.get('https://a.example')).toBeNull();
    expect(cache.get('https://c.example')).not.toBeNull();
    cache.set('https://huge.example', { rules: [{ allow: false, pattern: `/${'x'.repeat(20_000)}` }] });
    expect(cache.get('https://huge.example')).toBeNull();
    expect(cache.get('https://c.example')).not.toBeNull();
  });
});
