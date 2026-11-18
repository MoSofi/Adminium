// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The head the server writes into a `/x/` page (`routes/x-door/head.ts`):
 * every value of it escaped, whatever the owner typed, so the head keeps its
 * shape — one `<html>`, one `<title>`, the tags it spells and no other — and
 * each value reads back as the words it was; the robots tag is taken out
 * only for an answer that may be indexed.
 */
import { describe, expect, it } from 'vitest';

import { directionOf, headTags, ogLocaleOf, withHead, type XHead } from '../src/routes/x-door/head.js';

/** The bundle's own page, as `apps/dashboard/x/index.html` builds it. */
const BUILT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Form</title>
    <script type="module" crossorigin src="/x/assets/x-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/x/assets/x-abc123.css">
  </head>
  <body>
    <noscript>
      <p><strong>This form needs JavaScript.</strong></p>
    </noscript>
    <div id="x-root"></div>
  </body>
</html>
`;

/** What an owner might type to break out of a value, each a way into the page if a value went in raw. */
const HOSTILE = ['"><script src="/x/assets/x-abc123.js"></script>', '</title><meta http-equiv="refresh" content="0;url=https://evil.example">', "' onload='alert(1)", '<meta http-equiv=refresh content=0>', '&lt;b&gt; & "both" \'quotes\''];

/** Undo `escapeHtml`, to read a value back. */
function unescape(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The head's shape: each tag's name and the names of its attributes, in order, and the title's text. */
function shapeOf(html: string): { tags: string[]; title: string } {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const tags = [...head.matchAll(/<([a-z]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/g)].map(([, name, attrs]) => `${name}(${[...(attrs ?? '').matchAll(/([a-z-]+)(?:="[^"]*")?/g)].map(([, attr]) => attr).join(',')})`);
  const title = /<title>([^<]*)<\/title>/.exec(head)?.[1] ?? '';
  return { tags, title };
}

function head(value: string, more: Partial<XHead> = {}): XHead {
  return {
    lang: 'en-US',
    dir: 'ltr',
    title: value,
    description: value,
    share: { url: `https://pages.meridian.example/x/pages/open-day?${value}`, image: `https://pages.meridian.example/x/pages/api/open-day/pictures/f?${value}`, locale: ogLocaleOf('en-US') },
    indexable: true,
    ...more,
  };
}

describe('the head the server writes', () => {
  it('writes the language, the title, the description, the sharing tags and the canonical address, in that shape', () => {
    const html = withHead(BUILT, head('Open day at our Leeds showroom'));
    expect(html).toContain('<html lang="en-US" dir="ltr">');
    expect(html).toContain('<title>Open day at our Leeds showroom</title>');
    expect(html).not.toContain('<title>Form</title>');
    expect(html).not.toMatch(/name="robots"/);
    expect(shapeOf(html).tags).toEqual([
      'head()',
      'meta(charset)',
      'meta(name,content)',
      'meta(name,content)',
      'title()',
      'script(type,crossorigin,src)',
      'link(rel,crossorigin,href)',
      'meta(name,content)',
      'meta(property,content)',
      'meta(property,content)',
      'meta(property,content)',
      'meta(property,content)',
      'meta(property,content)',
      'meta(property,content)',
      'meta(name,content)',
      'link(rel,href)',
    ]);
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta property="og:locale" content="en_US" />');
    expect(html).toContain('<link rel="canonical" href="https://pages.meridian.example/x/pages/open-day?Open day at our Leeds showroom" />');
  });

  it('escapes every field: whatever is typed, the head keeps its shape and reads back as typed', () => {
    const plain = shapeOf(withHead(BUILT, head('Open day')));
    for (const value of HOSTILE) {
      const html = withHead(BUILT, head(value));
      const shape = shapeOf(html);
      expect(shape.tags, value).toEqual(plain.tags);
      expect(unescape(shape.title), value).toBe(value);
      // One script, the bundle's own; no refresh; nothing past the head's tags.
      expect(html.match(/<script/g)?.length, value).toBe(1);
      expect(html, value).not.toMatch(/<meta[^>]*http-equiv/i);
      expect(html.match(/<title>/g)?.length, value).toBe(1);
      expect(html.match(/<\/head>/g)?.length, value).toBe(1);
      // Every value reads back whole from its own attribute.
      const contents = [...html.matchAll(/<meta (?:name|property)="(description|og:title|og:description|og:url|og:image)" content="([^"]*)" \/>/g)].map(([, name, content]) => [name, unescape(content!)]);
      expect(Object.fromEntries(contents), value).toEqual({
        description: value,
        'og:title': value,
        'og:description': value,
        'og:url': `https://pages.meridian.example/x/pages/open-day?${value}`,
        'og:image': `https://pages.meridian.example/x/pages/api/open-day/pictures/f?${value}`,
      });
      // The language and direction too: a hostile tag is drawn as text inside its attribute.
      const lang = withHead(BUILT, head('Open day', { lang: value }));
      expect(shapeOf(lang).tags, value).toEqual(plain.tags);
      expect(unescape(/<html lang="([^"]*)" dir="ltr">/.exec(lang)?.[1] ?? ''), value).toBe(value);
    }
  });

  it('keeps the robots tag for an answer that may not be indexed, and writes no sharing tags for a page that is not shared', () => {
    const html = withHead(BUILT, { lang: 'de-DE', dir: 'ltr', title: 'Besuch im Showroom', indexable: false });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('<title>Besuch im Showroom</title>');
    expect(html).not.toMatch(/og:|twitter:|canonical|name="description"/);
    expect(headTags({ lang: 'en-US', dir: 'ltr', title: 'x', indexable: false })).toEqual([]);
  });

  it('says summary for a shared page without a picture, and writes right to left for Arabic', () => {
    const html = withHead(BUILT, { lang: 'ar-EG', dir: directionOf('ar-EG'), title: 'يوم مفتوح', description: 'تعال', share: { url: 'https://pages.meridian.example/x/pages/yawm', locale: ogLocaleOf('ar-EG') }, indexable: true });
    expect(html).toContain('<html lang="ar-EG" dir="rtl">');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).not.toContain('og:image');
    expect(directionOf('en-US')).toBe('ltr');
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('fa-IR')).toBe('rtl');
  });
});
