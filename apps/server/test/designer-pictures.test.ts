// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Free pictures for an app: the sources as they answer, what is kept of an
 * answer, the copy into the app, and the shelf a card's small copies are
 * served from. No test here calls another site: each source is given the
 * fetch it uses.
 */
import { describe, expect, it } from 'vitest';

import { createPictureShelf, downloadPicture, openverse, pexels, type FoundPicture } from '../src/designer/pictures.js';
import { createRegistry, registryOf } from '../src/designer/registry.js';
import { SafeFetchError } from '../src/net/safe-fetch.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const json = (value: unknown) => ({ body: Buffer.from(JSON.stringify(value)), contentType: 'application/json' });

describe('Openverse', () => {
  it('asks for pictures free to use and to change, of the shape wanted, and keeps what a card and a credit need', async () => {
    const asked: string[] = [];
    const source = openverse(async (url) => {
      asked.push(url);
      return json({
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
          // A small copy on any other host is not shown: the card's pictures come from one known place.
          { title: 'Elsewhere', url: 'https://x.example/a.jpg', thumbnail: 'https://evil.example/thumb.jpg', creator: 'x', license: 'by' },
          { title: 'Not https', url: 'http://x.example/a.jpg', thumbnail: 'javascript:alert(1)' },
          'not a row',
        ],
      });
    });
    const found = await source.search('pasta on a plate', { count: 5, shape: 'square' });
    expect(asked).toEqual(['https://api.openverse.org/v1/images/?q=pasta+on+a+plate&license_type=commercial%2Cmodification&mature=false&page_size=5&aspect_ratio=square']);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      title: 'Pasta b plate /b line two',
      creator: 'Ana Ruiz',
      licence: 'CC BY 2.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
      source: 'Openverse',
      page: 'https://www.flickr.com/photos/ana/1',
      thumb: 'https://api.openverse.org/v1/images/abc/thumb/',
      files: ['https://live.staticflickr.com/1/pasta_b.jpg', 'https://api.openverse.org/v1/images/abc/thumb/'],
    });
    expect(found[0]?.id).toMatch(/^pic_[0-9a-f]{12}$/);
    expect(await openverse(async () => json({ nope: true })).search('x y', { count: 1 })).toEqual([]);
  });
});

describe('Pexels', () => {
  it('sends the project’s key as a header, never in the address, and reads its own shape of answer', async () => {
    let seen: { url: string; headers: Record<string, string> | undefined } | null = null;
    const source = pexels('KEY-123', async (url, opts) => {
      seen = { url, headers: opts.headers };
      return json({ photos: [{ alt: 'A bar at night', photographer: 'Bo', photographer_url: 'https://www.pexels.com/@bo', url: 'https://www.pexels.com/photo/1/', src: { medium: 'https://images.pexels.com/photos/1/m.jpg', large: 'https://images.pexels.com/photos/1/l.jpg' } }] });
    });
    const found = await source.search('bar', { count: 3, shape: 'wide' });
    expect(seen).toEqual({ url: 'https://api.pexels.com/v1/search?query=bar&per_page=3&orientation=landscape', headers: { accept: 'application/json', authorization: 'KEY-123' } });
    expect(found[0]).toMatchObject({ creator: 'Bo', licence: 'Pexels licence', source: 'Pexels', files: ['https://images.pexels.com/photos/1/l.jpg', 'https://images.pexels.com/photos/1/m.jpg'] });
  });
});

describe('copying a picture into an app', () => {
  const picture: FoundPicture = { id: 'pic_000000000001', thumb: 'https://api.openverse.org/t', files: ['https://a.example/full.jpg', 'https://api.openverse.org/t'], title: 't', creator: 'c', creatorUrl: '', licence: 'CC BY', licenceUrl: '', source: 'Openverse', page: '' };

  it('takes the first of its files that IS a picture by its bytes, and falls back to the small copy', async () => {
    const tried: string[] = [];
    const got = await downloadPicture(picture, {
      fetcher: async (url) => {
        tried.push(url);
        if (url.includes('full')) throw new SafeFetchError('too-large', 'big');
        return { body: JPEG, contentType: 'text/html' };
      },
    });
    expect(tried).toEqual(['https://a.example/full.jpg', 'https://api.openverse.org/t']);
    expect(got).toMatchObject({ ext: 'jpg' });
  });

  it('keeps nothing that is not a picture, whatever the answer called it', async () => {
    for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', '<!doctype html><script>x</script>', 'GIF89a']) {
      expect(await downloadPicture(picture, { fetcher: async () => ({ body: Buffer.from(body), contentType: 'image/jpeg' }) }), body).toBeNull();
    }
  });
});

describe('the shelf a card’s pictures are served from', () => {
  const picture = (id: string): FoundPicture => ({ id, thumb: `https://api.openverse.org/${id}`, files: [], title: 't', creator: 'c', creatorUrl: '', licence: 'l', licenceUrl: '', source: 's', page: '' });

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
    expect(await shelf.thumb('ds_a', 'shelf_0000000000000000', 'pic_1')).toBeNull();
    expect(await shelf.thumb('ds_a', key, 'pic_9')).toBeNull();
    expect(fetched).toBe(1);
    shelf.drop(key);
    expect(shelf.find('ds_a', key, 'pic_1')).toBeNull();
  });

  it('serves nothing that is not a picture, and forgets the oldest shelves', async () => {
    const shelf = createPictureShelf({ max: 2, fetcher: async () => ({ body: Buffer.from('<html>'), contentType: 'image/jpeg' }) });
    const first = shelf.put('ds_a', [picture('pic_1')]);
    expect(await shelf.thumb('ds_a', first, 'pic_1')).toBeNull();
    shelf.put('ds_a', [picture('pic_2')]);
    shelf.put('ds_a', [picture('pic_3')]);
    expect(shelf.find('ds_a', first, 'pic_1')).toBeNull();
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
