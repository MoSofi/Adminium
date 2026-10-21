// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A fake of the four free-picture sources (Openverse, Pexels, Unsplash, Pixabay) and
 * the hosts their pictures are on, reached through the safe fetch's own
 * seams: `resolve` answers every name with a public address, `connect`
 * answers here. Nothing listens on a port. It counts the calls by host, so a
 * test can say what a search, a pin or an Apply spent.
 */
import type { PinnedTarget, RawResponse, SafeFetchOptions } from '../src/net/safe-fetch.js';

/** A small JPEG's first bytes, and some more: what every picture host serves. */
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

export type FakeSource = 'openverse' | 'pexels' | 'unsplash' | 'pixabay';

export interface FakePictures {
  seams: Pick<SafeFetchOptions, 'resolve' | 'connect'>;
  /** Calls made, by host. */
  calls: Record<string, number>;
  /** Every address asked, in order. */
  seen: string[];
  /** What a source's search answers instead, until taken off. */
  fail: Partial<Record<FakeSource, { status: number; headers?: Record<string, string> }>>;
  /** Originals that are larger than a spot takes: only the small copy fits. */
  big: Set<string>;
  /** Pictures that are gone from their host: every file of them answers 404. */
  gone: Set<string>;
}

const raw = (status: number, bytes: Buffer, headers: Record<string, string> = {}): RawResponse => ({
  status,
  headers: { 'content-length': String(bytes.length), ...headers },
  body: (async function* () {
    yield bytes;
  })(),
  destroy: () => undefined,
});
const json = (body: unknown, headers: Record<string, string> = {}): RawResponse => raw(200, Buffer.from(JSON.stringify(body)), { 'content-type': 'application/json', ...headers });

/** Openverse's licences, in turn: a credit asked, none, the same licence, and one that forbids selling (dropped). */
const LICENCES = ['by', 'cc0', 'by-sa', 'by-nc'];

export function fakePictures(): FakePictures {
  const fake: FakePictures = {
    calls: {},
    seen: [],
    fail: {},
    big: new Set(),
    gone: new Set(),
    seams: {
      resolve: async () => [{ address: '151.101.1.1', family: 4 }],
      connect: async (target: PinnedTarget) => answer(fake, target.url),
    },
  };
  return fake;
}

function answer(fake: FakePictures, url: URL): RawResponse {
  fake.seen.push(url.toString());
  fake.calls[url.hostname] = (fake.calls[url.hostname] ?? 0) + 1;
  const words = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
  const page = Number(url.searchParams.get('page') ?? '1');
  const slug = `${words.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${String(page)}`;
  const picture = (host: string, file: string): RawResponse => {
    if ([...fake.gone].some((name) => file.includes(name))) return raw(404, Buffer.from('gone'));
    // A large original says so before its bytes: the fetch refuses it on its length.
    if (fake.big.has(file)) return raw(200, FAKE_JPEG, { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) });
    return raw(200, Buffer.concat([FAKE_JPEG, Buffer.from(`${host}/${file}`)]), { 'content-type': 'image/jpeg' });
  };
  const failing = (source: FakeSource): RawResponse | null => {
    const fail = fake.fail[source];
    return fail === undefined ? null : raw(fail.status, Buffer.from('{}'), { 'content-type': 'application/json', ...(fail.headers ?? {}) });
  };

  if (url.hostname === 'api.openverse.org' && url.pathname === '/v1/images/') {
    const refused = failing('openverse');
    if (refused !== null) return refused;
    const results = Array.from({ length: 8 }, (_, index) => ({
      title: `${words} ${String(index + 1)}`,
      url: `https://live.staticflickr.com/${slug}-${String(index)}.jpg`,
      thumbnail: `https://api.openverse.org/v1/images/${slug}-${String(index)}/thumb/`,
      creator: `Maker ${String(index + 1)}`,
      creator_url: `https://www.flickr.com/people/${String(index)}`,
      license: LICENCES[index % LICENCES.length],
      license_version: index % LICENCES.length === 1 ? '1.0' : '2.0',
      license_url: 'https://creativecommons.org/licenses/by/2.0/',
      foreign_landing_url: `https://www.flickr.com/photos/${slug}-${String(index)}`,
    }));
    return json({ page_count: 3, results }, { 'x-ratelimit-remaining-anon_burst': '19' });
  }
  if (url.hostname === 'api.openverse.org' && url.pathname.endsWith('/thumb/')) return picture('openverse-thumb', url.pathname);
  if (url.hostname === 'live.staticflickr.com') return picture('flickr', url.pathname.slice(1));

  if (url.hostname === 'api.pexels.com') {
    const refused = failing('pexels');
    if (refused !== null) return refused;
    const photos = Array.from({ length: 6 }, (_, index) => ({
      alt: `${words} ${String(index + 1)}`,
      photographer: 'Bo',
      photographer_url: 'https://www.pexels.com/@bo',
      url: `https://www.pexels.com/photo/${slug}-${String(index)}/`,
      src: { medium: `https://images.pexels.com/m/${slug}-${String(index)}.jpg`, large2x: `https://images.pexels.com/l/${slug}-${String(index)}.jpg` },
    }));
    return json({ photos, ...(page < 2 ? { next_page: 'https://api.pexels.com/v1/search?page=2' } : {}) });
  }
  if (url.hostname === 'images.pexels.com') return picture('pexels', url.pathname.slice(1));

  if (url.hostname === 'api.unsplash.com' && url.pathname === '/search/photos') {
    const refused = failing('unsplash');
    if (refused !== null) return refused;
    const results = Array.from({ length: 4 }, (_, index) => ({
      alt_description: `${words} ${String(index + 1)}`,
      urls: { small: `https://images.unsplash.com/${slug}-${String(index)}?w=400`, regular: `https://images.unsplash.com/${slug}-${String(index)}?w=1080` },
      links: { html: `https://unsplash.com/photos/${slug}-${String(index)}`, download_location: `https://api.unsplash.com/photos/${slug}-${String(index)}/download` },
      user: { name: 'Ana', links: { html: 'https://unsplash.com/@ana' } },
    }));
    return json({ total_pages: 1, results }, { 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '49' });
  }
  if (url.hostname === 'api.unsplash.com' && url.pathname.endsWith('/download')) return json({ url: 'https://images.unsplash.com/x' });
  if (url.hostname === 'images.unsplash.com') return picture('unsplash', url.pathname.slice(1));

  if (url.hostname === 'pixabay.com' && url.pathname === '/api/') {
    const refused = failing('pixabay');
    if (refused !== null) return refused;
    const hits = Array.from({ length: 5 }, (_, index) => ({
      id: index,
      pageURL: `https://pixabay.com/photos/${slug}-${String(index)}/`,
      tags: `${words}, ${String(index + 1)}`,
      webformatURL: `https://pixabay.com/get/${slug}-${String(index)}_640.jpg`,
      largeImageURL: `https://pixabay.com/get/${slug}-${String(index)}_1280.jpg`,
      user: 'cam',
      user_id: 7,
    }));
    return json({ totalHits: 25, hits }, { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '99', 'x-ratelimit-reset': '60' });
  }
  if (url.hostname === 'pixabay.com' && url.pathname.startsWith('/get/')) return picture('pixabay', url.pathname.slice(5));
  return raw(404, Buffer.from('not here'));
}
