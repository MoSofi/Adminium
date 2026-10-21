// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Free pictures for an app: the sources as they answer, what is kept of an
 * answer, the copy into the app, and the shelf a card's small copies are
 * served from. No test here calls another site: each source is given the
 * fetch it uses.
 */
import { describe, expect, it } from 'vitest';

import { createPictureSearch, createSourceBudget, PAUSE_WITHOUT_WORD_MS, retryAt, SESSION_SEARCHES_PER_MINUTE, SOURCE_WINDOWS } from '../src/designer/picture-search.js';
import { createPictureShelf, downloadPicture, openverse, pexels, unsplash, type FoundPicture, type PictureSource } from '../src/designer/pictures.js';
import { createRegistry, registryOf } from '../src/designer/registry.js';
import { SafeFetchError } from '../src/net/safe-fetch.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const json = (value: unknown) => ({ body: Buffer.from(JSON.stringify(value)), contentType: 'application/json' });

describe('Openverse', () => {
  it('asks for pictures free to use and to change, of the shape wanted, and keeps what a tile and a credit need', async () => {
    const asked: string[] = [];
    const source = openverse(async (url) => {
      asked.push(url);
      return {
        ...json({
          page_count: 3,
          results: [
            {
              title: 'Pasta <b>plate</b>\nline two',
              url: 'https://live.staticflickr.com/1/pasta_b.jpg',
              thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/',
              creator: 'Ana `Ruiz`',
              creator_url: 'https://www.flickr.com/photos/ana',
              license: 'by',
              license_version: '2.0',
              license_url: 'https://creativecommons.org/licenses/by/2.0/',
              foreign_landing_url: 'https://www.flickr.com/photos/ana/1',
            },
            { title: 'Free', url: 'https://x.example/b.jpg', thumbnail: 'https://api.openverse.org/v1/images/b/thumb/', creator: 'x', license: 'cc0', license_version: '1.0' },
            { title: 'Marked', url: 'https://x.example/c.jpg', thumbnail: 'https://api.openverse.org/v1/images/c/thumb/', creator: 'x', license: 'pdm', license_version: '1.0' },
            // A licence this server does not know, or one that forbids a use: dropped, never shown as a known one.
            { title: 'Not to sell', url: 'https://x.example/d.jpg', thumbnail: 'https://api.openverse.org/v1/images/d/thumb/', creator: 'x', license: 'by-nc', license_version: '2.0' },
            { title: 'Unknown', url: 'https://x.example/e.jpg', thumbnail: 'https://api.openverse.org/v1/images/e/thumb/', creator: 'x', license: 'sampling+' },
            // A small copy on any other host is not shown: the tiles come from one known place.
            { title: 'Elsewhere', url: 'https://x.example/a.jpg', thumbnail: 'https://evil.example/thumb.jpg', creator: 'x', license: 'by' },
            { title: 'Not https', url: 'http://x.example/a.jpg', thumbnail: 'javascript:alert(1)' },
            'not a row',
          ],
        }),
        headers: { 'x-ratelimit-remaining-anon_burst': '17', 'x-ratelimit-remaining-anon_sustained': '190' },
      };
    });
    const found = await source.search('pasta on a plate', { count: 5, shape: 'square', page: 2 });
    expect(asked).toEqual(['https://api.openverse.org/v1/images/?q=pasta+on+a+plate&license_type=commercial%2Cmodification&mature=false&page_size=5&page=2&aspect_ratio=square']);
    expect(found.pictures.map((picture) => [picture.title, picture.licence, picture.licenceCode])).toEqual([
      ['Pasta b plate /b line two', 'CC BY 2.0', 'by'],
      ['Free', 'CC0 1.0', 'cc0'],
      ['Marked', 'Public Domain Mark 1.0', 'pdm'],
    ]);
    expect(found.pictures[0]).toMatchObject({
      creator: 'Ana Ruiz',
      licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
      source: 'Openverse',
      page: 'https://www.flickr.com/photos/ana/1',
      thumb: 'https://api.openverse.org/v1/images/abc/thumb/',
      files: ['https://live.staticflickr.com/1/pasta_b.jpg', 'https://api.openverse.org/v1/images/abc/thumb/'],
    });
    expect(found.pictures[0]?.id).toMatch(/^pic_[0-9a-f]{12}$/);
    // Page 2 of 3: there is more. The smallest count left is the one that binds.
    expect(found.more).toBe(true);
    expect(found.rate).toMatchObject({ remaining: 17 });
    expect(await openverse(async () => json({ nope: true })).search('x y', { count: 1 })).toEqual({ pictures: [], more: false, rate: { remaining: null, limit: null, resetAt: null } });
  });
});

describe('Pexels', () => {
  it('sends the project’s key as a header, never in the address, reads its own shape of answer and its next page', async () => {
    let seen: { url: string; headers: Record<string, string> | undefined } | null = null;
    const source = pexels('KEY-123', async (url, opts) => {
      seen = { url, headers: opts.headers };
      return {
        ...json({ next_page: 'https://api.pexels.com/v1/search?page=2', photos: [{ alt: 'A bar at night', photographer: 'Bo', photographer_url: 'https://www.pexels.com/@bo', url: 'https://www.pexels.com/photo/1/', src: { medium: 'https://images.pexels.com/photos/1/m.jpg', large: 'https://images.pexels.com/photos/1/l.jpg', large2x: 'https://images.pexels.com/photos/1/l2.jpg' } }] }),
        headers: { 'x-ratelimit-limit': '20000', 'x-ratelimit-remaining': '19684', 'x-ratelimit-reset': '1790000000' },
      };
    });
    const found = await source.search('bar', { count: 3, shape: 'wide' });
    expect(seen).toEqual({ url: 'https://api.pexels.com/v1/search?query=bar&per_page=3&page=1&orientation=landscape', headers: { accept: 'application/json', authorization: 'KEY-123' } });
    expect(found.pictures[0]).toMatchObject({ creator: 'Bo', licence: 'Pexels licence', licenceCode: 'pexels', source: 'Pexels', files: ['https://images.pexels.com/photos/1/l2.jpg', 'https://images.pexels.com/photos/1/m.jpg'] });
    expect(found.more).toBe(true);
    expect(found.rate).toEqual({ remaining: 19684, limit: 20000, resetAt: 1_790_000_000_000 });
  });
});

describe('Unsplash', () => {
  const photo = {
    alt_description: 'a table set for dinner',
    urls: { small: 'https://images.unsplash.com/photo-1?w=400', regular: 'https://images.unsplash.com/photo-1?w=1080' },
    links: { html: 'https://unsplash.com/photos/1', download_location: 'https://api.unsplash.com/photos/1/download?ixid=abc' },
    user: { name: 'Ana', links: { html: 'https://unsplash.com/@ana' } },
  };

  it('gives a picture as an address on its own picture host, never as a file to copy, with the key in a header', async () => {
    const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
    const source = unsplash('KEY-9', async (url, opts) => {
      calls.push({ url, headers: opts.headers });
      return json({
        total_pages: 1,
        results: [
          photo,
          // A picture whose address is on another host is left out: one site is let through, and it is this source's own.
          { ...photo, urls: { small: 'https://images.unsplash.com/photo-2?w=400', regular: 'https://cdn.elsewhere.example/photo-2' } },
          { ...photo, urls: { small: 'https://images.unsplash.com.evil.example/x', regular: 'https://images.unsplash.com/photo-3' } },
          // An address to tell that is not Unsplash's own is not kept.
          { ...photo, links: { html: 'https://unsplash.com/photos/4', download_location: 'https://evil.example/collect' } },
        ],
      });
    });
    expect(source.showsFrom).toBe('images.unsplash.com');
    const found = await source.search('dinner table', { count: 4, shape: 'square' });
    expect(calls).toEqual([{ url: 'https://api.unsplash.com/search/photos?query=dinner+table&per_page=4&page=1&content_filter=high&orientation=squarish', headers: { accept: 'application/json', authorization: 'Client-ID KEY-9', 'accept-version': 'v1' } }]);
    expect(found.pictures).toHaveLength(2);
    expect(found.more).toBe(false);
    expect(found.pictures[0]).toMatchObject({ files: [], shown: 'https://images.unsplash.com/photo-1?w=1080', thumb: 'https://images.unsplash.com/photo-1?w=400', creator: 'Ana', creatorUrl: 'https://unsplash.com/@ana', licence: 'Unsplash licence', licenceCode: 'unsplash', source: 'Unsplash', page: 'https://unsplash.com/photos/1', chosenUrl: 'https://api.unsplash.com/photos/1/download?ixid=abc' });
    expect(found.pictures[1]?.chosenUrl).toBeUndefined();
    // Nothing of it can be copied: there is no file to try.
    expect(await downloadPicture(found.pictures[0] as FoundPicture, { fetcher: async () => Promise.reject(new Error('must not be called')) })).toBeNull();

    // A chosen picture is told to Unsplash, with the key; one with no address to tell is not; a failure there is swallowed.
    await source.chosen?.(found.pictures[0] as FoundPicture);
    await source.chosen?.(found.pictures[1] as FoundPicture);
    expect(calls.slice(1).map((call) => `${call.url} ${call.headers?.['authorization'] ?? ''}`)).toEqual(['https://api.unsplash.com/photos/1/download?ixid=abc Client-ID KEY-9']);
    const failing = unsplash('KEY-9', async () => Promise.reject(new Error('down')));
    await expect(failing.chosen?.(found.pictures[0] as FoundPicture)).resolves.toBeUndefined();
  });

  it('pages no further than the dialog goes', async () => {
    const asked: string[] = [];
    const source = unsplash('K', async (url) => {
      asked.push(url);
      return json({ total_pages: 500, results: [] });
    });
    expect((await source.search('x', { count: 20, page: 10 })).more).toBe(false);
    expect((await source.search('x', { count: 20, page: 99 })).more).toBe(true);
    expect(asked[1]).toContain('page=1&');
  });
});

describe('copying a picture into an app', () => {
  const picture: FoundPicture = { id: 'pic_000000000001', thumb: 'https://api.openverse.org/t', files: ['https://a.example/full.jpg', 'https://api.openverse.org/t'], title: 't', creator: 'c', creatorUrl: '', licence: 'CC BY', licenceCode: 'by', licenceUrl: '', source: 'Openverse', page: '' };

  it('takes the original up to 5 MB, and says when only the small copy could be used', async () => {
    const tried: { url: string; most: number }[] = [];
    const got = await downloadPicture(picture, {
      fetcher: async (url, opts) => {
        tried.push({ url, most: opts.maxBytes });
        if (url.includes('full')) throw new SafeFetchError('too-large', 'big');
        return { body: JPEG, contentType: 'text/html' };
      },
    });
    expect(tried).toEqual([
      { url: 'https://a.example/full.jpg', most: 5 * 1024 * 1024 },
      { url: 'https://api.openverse.org/t', most: 5 * 1024 * 1024 },
    ]);
    expect(got).toMatchObject({ ext: 'jpg', small: true });
    expect(await downloadPicture(picture, { fetcher: async () => ({ body: JPEG, contentType: 'image/jpeg' }) })).toMatchObject({ small: false });
  });

  it('keeps nothing that is not a picture, whatever the answer called it; a GIF is a picture', async () => {
    for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', '<!doctype html><script>x</script>', 'GIF8']) {
      expect(await downloadPicture(picture, { fetcher: async () => ({ body: Buffer.from(body), contentType: 'image/jpeg' }) }), body).toBeNull();
    }
    expect(await downloadPicture(picture, { fetcher: async () => ({ body: Buffer.from('GIF89a\u0001\u0000', 'latin1'), contentType: 'image/gif' }) })).toMatchObject({ ext: 'gif' });
  });
});

describe('a session’s pages of results', () => {
  const picture = (id: string): FoundPicture => ({ id, thumb: `https://api.openverse.org/${id}`, files: [], title: 't', creator: 'c', creatorUrl: '', licence: 'l', licenceCode: 'cc0', licenceUrl: '', source: 'Openverse', page: '' });

  it('gives a small copy by ids alone, to the session it was put up for, fetched once', async () => {
    let fetched = 0;
    const shelf = createPictureShelf({
      fetcher: async () => {
        fetched += 1;
        return { body: JPEG, contentType: 'image/jpeg' };
      },
    });
    const key = shelf.put('ds_a', [picture('pic_1'), picture('pic_2')]);
    expect(key).toMatch(/^shelf_[0-9a-f]{16}$/);
    expect(await shelf.thumb('ds_a', key, 'pic_1')).toMatchObject({ mime: 'image/jpeg' });
    expect(await shelf.thumb('ds_a', key, 'pic_1')).not.toBeNull();
    expect(fetched).toBe(1);
    // Another session, another shelf, a picture not on it: nothing.
    expect(await shelf.thumb('ds_b', key, 'pic_1')).toBeNull();
    expect(shelf.pin('ds_b', key, 'pic_1')).toBeNull();
    expect(await shelf.thumb('ds_a', 'shelf_0000000000000000', 'pic_1')).toBeNull();
    expect(await shelf.thumb('ds_a', key, 'pic_9')).toBeNull();
    expect(fetched).toBe(1);
    shelf.drop(key);
    expect(shelf.find('ds_a', key, 'pic_1')).toBeNull();
  });

  it('keeps a dozen pages a session, and a picture the person pinned outlives its page: thirteen pages, then the pick from the first', async () => {
    const shelf = createPictureShelf({ fetcher: async () => ({ body: JPEG, contentType: 'image/jpeg' }) });
    const first = shelf.put('ds_a', [picture('pic_1'), picture('pic_2')]);
    expect(shelf.pin('ds_a', first, 'pic_1')).toMatchObject({ id: 'pic_1' });
    for (let page = 2; page <= 13; page += 1) shelf.put('ds_a', [picture(`pic_${String(page)}x`)]);
    expect(shelf.find('ds_a', first, 'pic_2')).toBeNull();
    expect(shelf.find('ds_a', first, 'pic_1')).toMatchObject({ id: 'pic_1' });
    expect(await shelf.thumb('ds_a', first, 'pic_1')).not.toBeNull();
    // Another session's pages are its own: it does not push this one's out.
    for (let page = 0; page < 20; page += 1) shelf.put('ds_b', [picture(`pic_b${String(page)}`)]);
    expect(shelf.find('ds_a', first, 'pic_1')).not.toBeNull();
  });

  it('adds “More” to the page it came from, and forgets a session half an hour after its last use', () => {
    let at = 0;
    const shelf = createPictureShelf({ now: () => at, fetcher: async () => ({ body: JPEG, contentType: 'image/jpeg' }) });
    const key = shelf.put('ds_a', [picture('pic_1')]);
    expect(shelf.add('ds_a', key, [picture('pic_2')])).toBe(true);
    expect(shelf.find('ds_a', key, 'pic_2')).not.toBeNull();
    expect(shelf.add('ds_b', key, [picture('pic_3')])).toBe(false);
    shelf.pin('ds_a', key, 'pic_1');
    at += 29 * 60_000;
    expect(shelf.find('ds_a', key, 'pic_1')).not.toBeNull();
    at += 31 * 60_000;
    expect(shelf.find('ds_a', key, 'pic_1')).toBeNull();
    expect(shelf.add('ds_a', key, [picture('pic_4')])).toBe(false);
  });

  it('serves nothing that is not a picture, and no small copy its source cannot spare', async () => {
    const shelf = createPictureShelf({ fetcher: async () => ({ body: Buffer.from('<html>'), contentType: 'image/jpeg' }) });
    const first = shelf.put('ds_a', [picture('pic_1')]);
    expect(await shelf.thumb('ds_a', first, 'pic_1')).toBeNull();
    let fetched = 0;
    const spare = createPictureShelf({ mayFetch: () => false, fetcher: async () => ((fetched += 1), { body: JPEG, contentType: 'image/jpeg' }) });
    const key = spare.put('ds_a', [picture('pic_1')]);
    expect(await spare.thumb('ds_a', key, 'pic_1')).toBeNull();
    expect(fetched).toBe(0);
  });
});

describe('what each source gives this server', () => {
  const found = (n: number): FoundPicture[] => Array.from({ length: n }, (_, index) => ({ id: `pic_${String(index)}`, thumb: 'https://api.openverse.org/t', files: [], title: 't', creator: 'c', creatorUrl: '', licence: 'CC0 1.0', licenceCode: 'cc0', licenceUrl: '', source: 'Openverse', page: '' }));
  const counting = (name: 'Openverse' | 'Pexels' | 'Unsplash', answer: () => Promise<{ pictures: FoundPicture[]; more: boolean }>) => {
    let calls = 0;
    const source: PictureSource = {
      name,
      search: async () => {
        calls += 1;
        return answer();
      },
    };
    return { source, calls: () => calls };
  };

  it('spends one budget a source for the whole server, and says how long a spent one waits', async () => {
    let at = 1_000_000;
    const openverse = counting('Openverse', async () => ({ pictures: found(2), more: true }));
    const search = createPictureSearch({ sources: () => [openverse.source], shelf: createPictureShelf({ now: () => at }), now: () => at });
    // Twenty a minute, from any session: the twenty-first waits for the bucket, and the source is never asked.
    for (let n = 0; n < 20; n += 1) expect((await search.search(`ds_${String(n % 3)}`, { q: 'pasta', source: 'Openverse' })).state, String(n)).toBe('ok');
    expect(await search.search('ds_x', { q: 'pasta', source: 'Openverse' })).toEqual({ state: 'busy', source: 'Openverse', minutes: 1 });
    expect(openverse.calls()).toBe(20);
    at += 3 * 60_000;
    expect((await search.search('ds_x', { q: 'pasta', source: 'Openverse' })).state).toBe('ok');
  });

  it('pauses only the source that answered 429, until its Retry-After, and the others keep working', async () => {
    let at = 1_000_000;
    const unsplash = counting('Unsplash', async () => {
      throw new SafeFetchError('status', 'The address answered 429.', 429, { 'retry-after': '720' });
    });
    const pexels = counting('Pexels', async () => ({ pictures: found(1), more: false }));
    const search = createPictureSearch({ sources: () => [pexels.source, unsplash.source], shelf: createPictureShelf({ now: () => at }), now: () => at });
    expect(await search.search('ds_a', { q: 'diner', source: 'Unsplash' })).toEqual({ state: 'busy', source: 'Unsplash', minutes: 12 });
    expect(await search.search('ds_a', { q: 'diner', source: 'Unsplash' })).toEqual({ state: 'busy', source: 'Unsplash', minutes: 12 });
    expect(unsplash.calls()).toBe(1);
    expect((await search.search('ds_a', { q: 'diner', source: 'Pexels' })).state).toBe('ok');
    expect(search.sources()).toEqual([{ name: 'Pexels', busy: null }, { name: 'Unsplash', busy: 12 }]);
    at += 12 * 60_000;
    expect(search.sources()[1]).toEqual({ name: 'Unsplash', busy: null });
    // A 429 with no word of when: a quarter of an hour (Pexels says nothing on one).
    expect(retryAt(undefined, 0)).toBe(PAUSE_WITHOUT_WORD_MS);
    expect(retryAt({ 'retry-after': new Date(5 * 60_000).toUTCString() }, 0)).toBe(5 * 60_000);
  });

  it('takes a source’s own word on what is left, and on its larger allowance for an approved key', () => {
    let at = 0;
    const budget = createSourceBudget(SOURCE_WINDOWS.Unsplash, () => at);
    budget.seen({ remaining: 2, limit: 1000, resetAt: null });
    expect(budget.take('search').ok).toBe(true);
    expect(budget.take('search').ok).toBe(true);
    expect(budget.take('search').ok).toBe(false);
    // An approved key refills at its own rate: 1,000 an hour is one every 3.6 seconds.
    at += 3600;
    expect(budget.take('search').ok).toBe(true);
    budget.seen({ remaining: 0, limit: null, resetAt: 90_000 });
    expect(budget.take('search')).toEqual({ ok: false, until: 90_000 });
    // Openverse counts its small copies on their own: a thousand a day.
    const ov = createSourceBudget(SOURCE_WINDOWS.Openverse, () => 0);
    for (let n = 0; n < 1000; n += 1) ov.take('thumb');
    expect(ov.take('thumb').ok).toBe(false);
    expect(ov.take('search').ok).toBe(true);
  });

  it('keeps a session to its own share, says when a source is off or failed, and puts “More” on the page it came from', async () => {
    const at = 1_000_000;
    const sources: PictureSource[] = [counting('Pexels', async () => ({ pictures: found(2), more: true })).source];
    const shelf = createPictureShelf({ now: () => at });
    const search = createPictureSearch({ sources: () => sources, shelf, now: () => at });
    const first = await search.search('ds_a', { q: 'bar', source: 'Pexels' });
    if (first.state !== 'ok') throw new Error('not ok');
    expect(first.pictures[0]).toEqual({ id: 'pic_0', title: 't', creator: 'c', source: 'Openverse', licence: { code: 'cc0', name: 'CC0 1.0' }, page: '' });
    const more = await search.search('ds_a', { q: 'bar', source: 'Pexels', page: 2, shelf: first.shelf });
    expect(more).toMatchObject({ state: 'ok', shelf: first.shelf, page: 2 });
    for (let n = 2; n < SESSION_SEARCHES_PER_MINUTE; n += 1) await search.search('ds_a', { q: 'bar', source: 'Pexels' });
    expect(await search.search('ds_a', { q: 'bar', source: 'Pexels' })).toMatchObject({ state: 'busy', source: 'Pexels' });
    expect((await search.search('ds_b', { q: 'bar', source: 'Pexels' })).state).toBe('ok');
    expect(await search.search('ds_a', { q: 'bar', source: 'Unsplash' })).toEqual({ state: 'off' });
    sources.push(counting('Openverse', async () => Promise.reject(new SafeFetchError('network', 'down'))).source);
    expect(await search.search('ds_c', { q: 'bar', source: 'Openverse' })).toEqual({ state: 'failed' });
  });
});

describe('a package’s newest version', () => {
  it('is asked of the registry the project installs from, a scoped name as one path piece, and kept', async () => {
    const asked: string[] = [];
    const newest = createRegistry({
      root: '/nowhere',
      env: {},
      fetch: async (url) => {
        asked.push(url);
        if (url.includes('no-such')) throw new SafeFetchError('status', '404', 404);
        if (url.includes('weird')) return { body: Buffer.from('{"latest":"^1.0.0 || evil"}') };
        if (url.endsWith('/tailwindcss/dist-tags')) return { body: Buffer.from('{"latest":"5.0.1"}') };
        return { body: Buffer.from('{"latest":"5.2.8","next":"6.0.0-beta.1"}') };
      },
    });
    expect(await newest('@fontsource/inter')).toBe('5.2.8');
    expect(await newest('@fontsource/inter')).toBe('5.2.8');
    expect(asked).toEqual(['https://registry.npmjs.org/-/package/@fontsource%2Finter/dist-tags']);
    // No such package; a version that is no version; a Tailwind this build does not know; a name that is no name.
    expect(await newest('no-such-thing')).toBeNull();
    expect(await newest('weird')).toBeNull();
    expect(await newest('tailwindcss')).toBeNull();
    expect(await newest('../../etc/passwd')).toBeNull();
  });

  it('throws when the registry cannot be asked, and asks nothing where the server calls nothing outside', async () => {
    const down = createRegistry({ root: '/nowhere', env: {}, fetch: async () => Promise.reject(new SafeFetchError('network', 'down')) });
    await expect(down('clsx')).rejects.toThrow();
    let called = false;
    const off = createRegistry({ root: '/nowhere', env: {}, allowed: () => false, fetch: async () => ((called = true), { body: Buffer.from('{}') }) });
    await expect(off('clsx')).rejects.toThrow(/calls? nothing outside/);
    expect(called).toBe(false);
    expect(registryOf('/nowhere', { npm_config_registry: 'https://npm.example.com/' })).toBe('https://npm.example.com');
    expect(registryOf('/nowhere', {})).toBe('https://registry.npmjs.org');
  });
});
