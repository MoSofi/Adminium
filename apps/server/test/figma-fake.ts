// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A fake of Figma's REST API and its picture storage, reached through the safe fetch's own seams:
 * `resolve` answers every name with a public address, and `connect` answers the request in this
 * process. Nothing listens on a port. It counts every call by kind, so a test can say how many of
 * Figma's counted reads (`nodes`, `images`) an action spent.
 */
import { PNG } from 'pngjs';

import type { FigmaNodeAnswer } from '../src/designer/figma/client.js';
import { findNode } from '../src/designer/figma/distil.js';
import type { PinnedTarget, RawResponse, SafeFetchOptions } from '../src/net/safe-fetch.js';

export interface FakeFile {
  name: string;
  version: string;
  nodes: Record<string, FigmaNodeAnswer>;
}

export interface FakeFigma {
  seams: Pick<SafeFetchOptions, 'resolve' | 'connect'>;
  /** Tokens Figma knows, and whose they are. */
  tokens: Map<string, { id: string; handle: string }>;
  /** Which tokens may open which files (all of them, when a file is not listed). */
  access: Map<string, Set<string>>;
  files: Map<string, FakeFile>;
  /** Calls made, by kind. */
  calls: { me: number; meta: number; nodes: number; images: number; download: number };
  /** The headers each call carried, in order. */
  seen: { url: string; headers: Record<string, string> }[];
  /** What the next calls of a kind answer instead: a status and its headers, `null-image`, a picture of its own. */
  fail: Partial<Record<'me' | 'meta' | 'nodes' | 'images' | 'download', { status: number; headers?: Record<string, string> } | 'null-image' | 'hang'>>;
  /** The picture each render serves; a small PNG when not set. */
  picture?: Buffer;
  /** Held calls of a kind wait for this before they answer. */
  gate?: Promise<void>;
}

/** A PNG of the given size, filled with noise when asked (noise does not compress, so its file is large). */
export function pngOf(width: number, height: number, noise = false): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    const value = noise ? Math.floor(Math.random() * 256) : 200;
    png.data[i] = value;
    png.data[i + 1] = noise ? Math.floor(Math.random() * 256) : 120;
    png.data[i + 2] = noise ? Math.floor(Math.random() * 256) : 60;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): RawResponse => {
  const bytes = Buffer.from(JSON.stringify(body));
  return { status, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), ...headers }, body: (async function* () { yield bytes; })(), destroy: () => {} };
};

export function fakeFigma(): FakeFigma {
  const fake: FakeFigma = {
    tokens: new Map([['figd_good_token_0001', { id: '1111', handle: 'ava.reyes' }]]),
    access: new Map(),
    files: new Map(),
    calls: { me: 0, meta: 0, nodes: 0, images: 0, download: 0 },
    seen: [],
    fail: {},
    seams: {
      resolve: async () => [{ address: '151.101.1.1', family: 4 }],
      connect: async (target: PinnedTarget, opts: { headers: Record<string, string>; signal: AbortSignal }) =>
        Promise.race([
          answer(fake, target.url, opts.headers),
          new Promise<never>((_, reject) => {
            opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
        ]),
    },
  };
  return fake;
}

async function answer(fake: FakeFigma, url: URL, headers: Record<string, string>): Promise<RawResponse> {
  fake.seen.push({ url: url.toString(), headers });
  const kind: keyof FakeFigma['calls'] | null =
    url.hostname === 'figma-storage.example' ? 'download'
    : url.pathname === '/v1/me' ? 'me'
    : /^\/v1\/files\/[^/]+\/meta$/.test(url.pathname) ? 'meta'
    : /^\/v1\/files\/[^/]+\/nodes$/.test(url.pathname) ? 'nodes'
    : /^\/v1\/images\/[^/]+$/.test(url.pathname) ? 'images'
    : null;
  if (kind === null) return json(404, { status: 404, err: 'Not found' });
  fake.calls[kind] += 1;
  if (fake.gate !== undefined) await fake.gate;
  const failing = fake.fail[kind];
  if (failing === 'hang') return new Promise(() => {});
  if (failing !== undefined && failing !== 'null-image') return json(failing.status, { status: failing.status, err: 'refused' }, failing.headers);
  if (kind === 'download') {
    const bytes = fake.picture ?? pngOf(40, 30);
    return { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) }, body: (async function* () { yield bytes; })(), destroy: () => {} };
  }
  if (url.hostname !== 'api.figma.com') return json(404, {});
  const token = headers['x-figma-token'] ?? '';
  const who = fake.tokens.get(token);
  if (who === undefined) return json(403, { status: 403, err: 'Invalid token' });
  if (kind === 'me') return json(200, { id: who.id, handle: who.handle, email: `${who.handle}@example.com`, img_url: 'https://example.com/a.png' });
  const key = decodeURIComponent(url.pathname.split('/')[3] ?? '');
  const file = fake.files.get(key);
  const allowed = fake.access.get(key);
  if (file === undefined || (allowed !== undefined && !allowed.has(token))) return json(403, { status: 403, err: 'Forbidden' });
  if (kind === 'meta') return json(200, { file: { name: file.name, version: file.version, last_touched_at: '2026-10-20T10:00:00Z', editorType: 'figma' } });
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter((id) => id !== '');
  // A node inside a frame is answered as Figma does: its own subtree, with the frame's maps.
  const nodeOf = (id: string): FigmaNodeAnswer | null => {
    for (const answer of Object.values(file.nodes)) {
      const found = findNode(answer.document, id);
      if (found !== null) return { ...answer, document: found };
    }
    return null;
  };
  if (kind === 'nodes') return json(200, { name: file.name, version: file.version, lastModified: '2026-10-20T10:00:00Z', role: 'viewer', editorType: 'figma', nodes: Object.fromEntries(ids.map((id) => [id, nodeOf(id)])) });
  const inFile = (id: string): boolean => Object.values(file.nodes).some((answer) => findNode(answer.document, id) !== null);
  return json(200, { err: null, images: Object.fromEntries(ids.map((id) => [id, failing === 'null-image' || !inFile(id) ? null : `https://figma-storage.example/render/${encodeURIComponent(id)}.png?sig=abc`])) });
}

/** A small frame: a page with an auto-layout header, a text, a picture and a button instance. */
export function checkoutFrame(id = '1:2'): FigmaNodeAnswer {
  return {
    document: {
      id,
      name: 'Checkout',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1024 },
      layoutMode: 'VERTICAL',
      itemSpacing: 24,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 40,
      paddingBottom: 40,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [
        {
          id: '1:3',
          name: 'Title',
          type: 'TEXT',
          characters: 'Your order',
          style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 32, lineHeightPx: 40 },
          fills: [{ type: 'SOLID', color: { r: 0.067, g: 0.067, b: 0.078, a: 1 } }],
          absoluteBoundingBox: { x: 32, y: 40, width: 300, height: 40 },
        },
        {
          id: '1:4',
          name: 'Hero photo',
          type: 'RECTANGLE',
          fills: [{ type: 'IMAGE', scaleMode: 'FILL', imageRef: 'abc' }],
          absoluteBoundingBox: { x: 32, y: 104, width: 1376, height: 480 },
          cornerRadius: 14,
        },
        {
          id: '1:5',
          name: 'Pay',
          type: 'INSTANCE',
          componentId: '9:1',
          absoluteBoundingBox: { x: 32, y: 608, width: 200, height: 48 },
          children: [{ id: 'I1:5;9:2', name: 'Label', type: 'TEXT', characters: 'Pay now', style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 16, lineHeightPx: 24 } }],
        },
      ],
    },
    components: { '9:1': { key: 'k1', name: 'Button/Primary', description: '' } },
    styles: {},
  };
}
