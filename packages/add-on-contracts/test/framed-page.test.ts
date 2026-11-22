// SPDX-License-Identifier: AGPL-3.0-only
/** An add-on's framed page: what it may name, the policy it is served with, and the page itself. */
import { describe, expect, it } from 'vitest';

import { framedPageHtml, framedPagePath, framedPagePolicy, framedPageSchema, framedScriptPath, type FramedPage } from '../src/framed-page.js';

const ORIGIN = 'https://desk.example';
const page = (change: Partial<FramedPage> = {}): FramedPage => ({ script: 'dist/frame.js', title: 'Reviews', hosts: {}, ...change });
const directives = (policy: string): Map<string, string> =>
  new Map(policy.split('; ').map((part) => {
    const at = part.indexOf(' ');
    return [part.slice(0, at), part.slice(at + 1)];
  }));

describe('what a framed page may name', () => {
  it('takes a built script and https hosts', () => {
    expect(framedPageSchema.safeParse(page({ hosts: { script: ['https://maps.googleapis.com', 'https://*.gstatic.com'] } })).success).toBe(true);
  });

  it.each(['*', 'https://*', 'http://maps.example', 'https://maps.example/path', "'unsafe-inline'", 'https://a.example; script-src *'])('refuses the host %s', (host) => {
    expect(framedPageSchema.safeParse(page({ hosts: { connect: [host] } })).success).toBe(false);
  });

  it.each(['frame.js', 'dist/../secret.js', 'dist/frame.css', 'https://cdn.example/dist/frame.js'])('refuses the script %s', (script) => {
    expect(framedPageSchema.safeParse(page({ script })).success).toBe(false);
  });

  it('refuses a directive it does not list, and a false eval flag', () => {
    expect(framedPageSchema.safeParse({ ...page(), hosts: { object: ['https://a.example'] } }).success).toBe(false);
    expect(framedPageSchema.safeParse({ ...page(), evalScripts: false }).success).toBe(false);
  });
});

describe('the policy a framed page is served with', () => {
  it('sandboxes the page with no origin of its own, and allows only its own script', () => {
    const policy = directives(framedPagePolicy(ORIGIN, 'reviews', page(), []));
    expect(policy.get('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(policy.get('sandbox')).not.toContain('allow-same-origin');
    expect(policy.get('default-src')).toBe("'none'");
    expect(policy.get('script-src')).toBe(`${ORIGIN}/x/add-on-frame/reviews/frame.js`);
    expect(policy.get('style-src')).toBe("'unsafe-inline'");
    expect(policy.get('img-src')).toBe('data:');
    expect(policy.get('base-uri')).toBe("'none'");
    expect(policy.get('form-action')).toBe("'none'");
    expect(policy.get('frame-ancestors')).toBe(ORIGIN);
    for (const absent of ['font-src', 'connect-src', 'frame-src', 'worker-src']) expect(policy.has(absent)).toBe(false);
  });

  it('adds each listed host to its own directive, and the listed websites as framers', () => {
    const policy = directives(framedPagePolicy(ORIGIN, 'reviews', page({
      hosts: {
        script: ['https://s.example'],
        style: ['https://st.example'],
        img: ['https://i.example'],
        font: ['https://f.example'],
        connect: ['https://c.example'],
        frame: ['https://fr.example'],
      },
    }), ['https://shop.example']));
    expect(policy.get('script-src')).toBe(`${ORIGIN}/x/add-on-frame/reviews/frame.js https://s.example`);
    expect(policy.get('style-src')).toBe("'unsafe-inline' https://st.example");
    expect(policy.get('img-src')).toBe('data: https://i.example');
    expect(policy.get('font-src')).toBe('https://f.example');
    expect(policy.get('connect-src')).toBe('https://c.example');
    expect(policy.get('frame-src')).toBe('https://fr.example');
    expect(policy.get('frame-ancestors')).toBe(`${ORIGIN} https://shop.example`);
  });

  it('allows compiled code and blob workers only when the page says so', () => {
    expect(framedPagePolicy(ORIGIN, 'reviews', page(), [])).not.toContain('unsafe-eval');
    const policy = directives(framedPagePolicy(ORIGIN, 'reviews', page({ evalScripts: true }), []));
    expect(policy.get('script-src')).toBe(`${ORIGIN}/x/add-on-frame/reviews/frame.js 'unsafe-eval' blob:`);
    expect(policy.get('worker-src')).toBe('blob:');
  });
});

describe('the framed page itself', () => {
  it('has its paths under the add-on', () => {
    expect(framedPagePath('reviews')).toBe('/x/add-on-frame/reviews');
    expect(framedScriptPath('reviews')).toBe('/x/add-on-frame/reviews/frame.js');
  });

  it('loads its one script and escapes its title', () => {
    const html = framedPageHtml('reviews', page({ title: 'A&B <script>alert(1)</script>' }));
    expect(html).toContain('/x/add-on-frame/reviews/frame.js');
    expect(html).toContain('<title>A&amp;B &lt;script&gt;alert(1)&lt;/script&gt;</title>');
    expect(html).not.toContain('<script>alert');
  });
});
