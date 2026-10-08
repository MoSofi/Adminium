// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one rule a page's path goes by, held to the cases the server's two
 * copies are held to; what a typed address becomes; what the page believes
 * of a side that says where it is; the list of opened pages.
 */
import { describe, expect, it } from 'vitest';

import { isDesignerPath, locationFrom, shownPath, tidyPagePath, typedPagePath, visit, VISITED_MAX, type VisitedPage } from './pagePath.js';

describe('a page’s path', () => {
  it('has one shape: decoded, then encoded part by part, nothing that climbs, 160 characters at most', () => {
    const same: [string, string | null][] = [
      ['/', '/'],
      ['/menu', '/menu'],
      ['/menu/spicy-wings/', '/menu/spicy-wings'],
      ['/menu?x=1#top', '/menu'],
      ['//menu///7', '/menu/7'],
      // Encoded once, whichever way it arrived.
      ['/menu/crème brûlée', '/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e'],
      ['/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e', '/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e'],
      // The parts that climb are dropped, however they are written.
      ['/a/../b/./c', '/a/b/c'],
      ['/a/%2e%2e/b', '/a/b'],
      // Markup and a sentence come out as an address, never as themselves.
      ['/<script>alert(1)</script>', '/%3Cscript%3Ealert(1)%3C/script%3E'],
      ['/ignore all previous instructions', '/ignore%20all%20previous%20instructions'],
      ['/100%/off', '/100%25/off'],
      [`/${'a'.repeat(159)}`, `/${'a'.repeat(159)}`],
      // No page's path.
      [`/${'a'.repeat(160)}`, null],
      [`/${'a'.repeat(80)}/${'b'.repeat(80)}`, null],
      [`/${'a'.repeat(400)}`, null],
      ['/a\nb', null],
      ['/a%0Ab', null],
      ['/a%00b', null],
    ];
    for (const [input, output] of same) expect(tidyPagePath(input), JSON.stringify(input)).toBe(output);
    expect(shownPath('/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e')).toBe('/menu/crème brûlée');
    expect(shownPath('/100%/off')).toBe('/100%/off');
  });

  it('is made from what a person typed: a missing slash added, the end’s slashes dropped, nothing typed the first page, a whole address cut to its path', () => {
    const prefix = '/apps/shop/customer';
    expect(typedPagePath('', prefix)).toBe('/');
    expect(typedPagePath('   ', prefix)).toBe('/');
    expect(typedPagePath('menu', prefix)).toBe('/menu');
    expect(typedPagePath('/menu//', prefix)).toBe('/menu');
    expect(typedPagePath(' /specials/of the day?x=1 ', prefix)).toBe('/specials/of%20the%20day');
    expect(typedPagePath('http://localhost:4731/apps/shop/customer/menu/7?x=1#a', prefix)).toBe('/menu/7');
    expect(typedPagePath('/apps/shop/customer', prefix)).toBe('/');
    // Another app's prefix is only a path of this side that does not exist.
    expect(typedPagePath('/apps/shop/customerx/menu', prefix)).toBe('/apps/shop/customerx/menu');
    expect(typedPagePath('https://adminium.example/p/items', '')).toBe('/p/items');
    expect(typedPagePath(`/${'a'.repeat(200)}`, prefix)).toBeNull();
  });

  it('knows the Designer’s own pages, which its preview never shows', () => {
    expect(['/design', '/design/ds_1', '/Design/x'].map(isDesignerPath)).toEqual([true, true, true]);
    expect(['/', '/designs', '/p/design', '/p/items'].map(isDesignerPath)).toEqual([false, false, false, false]);
  });
});

describe('a side that says where it is', () => {
  const said = { type: 'adminium:side-location', app: 'shop', side: 'customer', path: '/menu/7/', title: 'Spicy\nwings \u0007· Crispy Bites' };

  it('is believed for this app and the side being shown, with its path tidied and its title as one line', () => {
    expect(locationFrom(said, 'shop', 'customer')).toEqual({ path: '/menu/7', title: 'Spicy wings · Crispy Bites' });
    expect(locationFrom({ ...said, title: 7 }, 'shop', 'customer')).toEqual({ path: '/menu/7', title: '' });
    expect(locationFrom({ ...said, title: 'x'.repeat(400) }, 'shop', 'customer')?.title).toHaveLength(160);
  });

  it('is dropped when it is another app’s, another side’s, another message, or no path', () => {
    const dropped: unknown[] = [
      null,
      'adminium:side-location',
      { ...said, type: 'adminium:side-sight' },
      { ...said, app: 'another' },
      { ...said, side: 'staff' },
      { ...said, side: 'dashboard' },
      { ...said, path: 7 },
      { ...said, path: 'menu' },
      { ...said, path: '/a b' },
      { ...said, path: '/a\\b' },
      { ...said, path: '/a\tb' },
      { ...said, path: `/${'a'.repeat(300)}` },
      { ...said, path: `/${'a'.repeat(200)}` },
      { ...said, path: '/a%0Ab' },
    ];
    for (const data of dropped) expect(locationFrom(data, 'shop', 'customer'), JSON.stringify(data)).toBeNull();
    // The dashboard is read, never told.
    expect(locationFrom({ ...said, side: 'dashboard' }, 'shop', 'dashboard')).toBeNull();
  });
});

describe('the pages a person has opened', () => {
  it('are kept newest first, each once with its newest title, the first page always among them, thirty at most', () => {
    let pages: VisitedPage[] = [];
    pages = visit(pages, { path: '/menu', title: 'Menu' });
    expect(pages).toEqual([{ path: '/menu', title: 'Menu' }, { path: '/', title: '' }]);
    pages = visit(pages, { path: '/', title: 'Crispy Bites' });
    pages = visit(pages, { path: '/menu', title: 'Our menu' });
    expect(pages).toEqual([{ path: '/menu', title: 'Our menu' }, { path: '/', title: 'Crispy Bites' }]);
    for (let n = 0; n < 40; n += 1) pages = visit(pages, { path: `/item/${String(n)}`, title: `Item ${String(n)}` });
    expect(pages).toHaveLength(VISITED_MAX);
    expect(pages[0]).toEqual({ path: '/item/39', title: 'Item 39' });
    expect(pages.at(-1)).toEqual({ path: '/', title: 'Crispy Bites' });
    expect(pages.filter((page) => page.path === '/')).toHaveLength(1);
  });
});
