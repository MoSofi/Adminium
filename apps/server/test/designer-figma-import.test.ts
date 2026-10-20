// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading a frame from Figma: the cache by version, the two halves kept apart, one import at a time,
 * the count and the pause by Figma account, and the picture made to fit. Every counted read is
 * counted on the fake.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FigmaPause } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cacheOutlivesDeploys, createFigmaCache } from '../src/designer/figma/cache.js';
import { createFigmaClient, FigmaError, type FigmaRefusal } from '../src/designer/figma/client.js';
import { createFigmaReader, fitPicture, FigmaAllowanceError } from '../src/designer/figma/service.js';
import type { FigmaCredential, FigmaTokens } from '../src/designer/figma/tokens.js';
import { checkoutFrame, fakeFigma, pngOf, type FakeFigma } from './figma-fake.js';

const KEY = 'AbCdEf0123456789';
const LINK = { fileKey: KEY, nodeId: '1:2' };
const AVA = 'usr_ava';
const BEN = 'usr_ben';

/** Tokens kept in memory, with the pause by Figma account as the real store keeps it. */
function memoryTokens(tokens: Record<string, string>): FigmaTokens & { pauses: Map<string, FigmaPause> } {
  const pauses = new Map<string, FigmaPause>();
  return {
    pauses,
    status: async (userId) => (tokens[userId] === undefined ? { connected: false, source: null, handle: null } : { connected: true, source: 'mine', handle: 'x' }),
    figmaTokenOf: async (userId): Promise<FigmaCredential | null> => (tokens[userId] === undefined ? null : { token: tokens[userId] as string, source: 'mine', figmaUserId: null }),
    save: async () => true,
    remove: async () => true,
    pausedFor: async (account) => pauses.get(account) ?? null,
    pause: async (account, pause) => {
      pauses.set(account, pause);
    },
    unpause: async (account) => {
      pauses.delete(account);
    },
  };
}

let root: string;
let fake: FakeFigma;
let now: number;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-figma-'));
  fake = fakeFigma();
  fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': checkoutFrame() } });
  now = Date.UTC(2026, 9, 20);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const setup = (tokens: Record<string, string> = { [AVA]: 'figd_good_token_0001' }, cacheMax?: number) => {
  const store = memoryTokens(tokens);
  const cache = createFigmaCache(root, cacheMax === undefined ? {} : { maxBytes: cacheMax });
  const reader = createFigmaReader({ client: createFigmaClient({ allowed: () => true, seams: fake.seams, timeoutMs: 2000 }), cache, tokens: store, now: () => now });
  return { reader, store, cache };
};
const tier1 = (): number => fake.calls.nodes + fake.calls.images;
const refusalOf = async (work: Promise<unknown>): Promise<FigmaRefusal | null> => {
  try {
    await work;
    return null;
  } catch (error) {
    if (error instanceof FigmaError) return error.refusal;
    throw error;
  }
};

describe('importing a frame', () => {
  it('spends two counted reads the first time, none for the same version, two again once the file moved', async () => {
    const { reader } = setup();
    const first = await reader.importFrame(AVA, LINK);
    expect(first).toMatchObject({ fileKey: KEY, nodeId: '1:2', version: '42', fileName: 'Crispy Bites', frame: 'Checkout', width: 1440, height: 1024, reads: 2 });
    expect(first.outline).toContain('# "Checkout" — Figma design');
    expect(first.short.length).toBeLessThanOrEqual(4000);
    expect(first.picture.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(tier1()).toBe(2);
    // The render was asked at about 2 MP: the long side at 2,000 px.
    expect(fake.seen.find((call) => call.url.includes('/v1/images/'))?.url).toContain('scale=1.389');

    const again = await reader.importFrame(AVA, LINK);
    expect(again.reads).toBe(0);
    expect(tier1()).toBe(2);
    expect(fake.calls.meta).toBe(2);

    fake.files.set(KEY, { name: 'Crispy Bites', version: '43', nodes: { '1:2': checkoutFrame() } });
    expect((await reader.importFrame(AVA, LINK)).reads).toBe(2);
    expect(tier1()).toBe(4);
  });

  it('keeps the frame’s nodes when its picture fails, so a retry spends one read', async () => {
    const { reader } = setup();
    fake.fail.images = 'null-image';
    expect(await refusalOf(reader.importFrame(AVA, LINK))).toEqual({ kind: 'render-failed' });
    expect(tier1()).toBe(2);
    delete fake.fail.images;
    expect((await reader.importFrame(AVA, LINK)).reads).toBe(1);
    expect(tier1()).toBe(3);
  });

  it('runs one import of a frame at a time: a second caller gets the first one’s answer', async () => {
    const { reader } = setup();
    let open: () => void = () => {};
    fake.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const one = reader.importFrame(AVA, LINK);
    const two = reader.importFrame(AVA, LINK);
    open();
    const [a, b] = await Promise.all([one, two]);
    expect(a).toBe(b);
    expect(tier1()).toBe(2);
  });

  it('makes a render over 5 MB smaller here, with no other call to Figma', async () => {
    const { reader } = setup();
    fake.picture = pngOf(1500, 1100, true);
    expect(fake.picture.length).toBeGreaterThan(5 * 1024 * 1024);
    const done = await reader.importFrame(AVA, LINK);
    expect(done.picture.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(done.picture.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(fake.calls.images).toBe(1);
    expect(fake.calls.download).toBe(1);
  });

  it('says a frame that is not in the file, and a file the account cannot open', async () => {
    const { reader } = setup();
    expect(await refusalOf(reader.importFrame(AVA, { fileKey: KEY, nodeId: '7:7' }))).toEqual({ kind: 'no-frame' });
    fake.access.set(KEY, new Set(['someone-else']));
    expect(await refusalOf(reader.importFrame(AVA, LINK))).toEqual({ kind: 'no-access' });
    expect(await refusalOf(reader.importFrame(BEN, LINK))).toEqual({ kind: 'not-connected' });
    const dead = setup({ [AVA]: 'figd_dead_token_0000' }).reader;
    expect(await refusalOf(dead.importFrame(AVA, LINK))).toEqual({ kind: 'token' });
  });

  it('keeps each person’s copies apart: another person’s import reads Figma with their own token', async () => {
    fake.tokens.set('figd_ben_token_0002', { id: '2222', handle: 'ben' });
    const { reader } = setup({ [AVA]: 'figd_good_token_0001', [BEN]: 'figd_ben_token_0002' });
    await reader.importFrame(AVA, LINK);
    expect((await reader.importFrame(BEN, LINK)).reads).toBe(2);
    expect(fake.seen.filter((call) => call.url.includes('/nodes')).map((call) => call.headers['x-figma-token'])).toEqual(['figd_good_token_0001', 'figd_ben_token_0002']);
    // Counted by Figma account, never by the person.
    expect(reader.readsBy('1111')).toBe(2);
    expect(reader.readsBy('2222')).toBe(2);
    expect(reader.readsBy(AVA)).toBe(0);
  });

  it('counts two people on one Figma account as one', async () => {
    const { reader } = setup({ [AVA]: 'figd_good_token_0001', [BEN]: 'figd_good_token_0001' });
    await reader.importFrame(AVA, LINK);
    await reader.importFrame(BEN, LINK);
    expect(reader.readsBy('1111')).toBe(4);
  });
});

describe('Figma’s limit', () => {
  it('pauses the model’s reads until the date Figma gave; the person’s own import still tries, and lifts it', async () => {
    const { reader, store } = setup();
    fake.fail.nodes = { status: 429, headers: { 'retry-after': String(5 * 86400), 'x-figma-rate-limit-type': 'low' } };
    expect(await refusalOf(reader.importFrame(AVA, LINK))).toEqual({ kind: 'limit', type: 'low', retryAfterSeconds: 5 * 86400 });
    expect(store.pauses.get('1111')).toEqual({ until: now + 5 * 86400 * 1000, dated: true });
    const calls = tier1();
    // The model's read stops before any call; the frame's own reads by the person still try.
    expect(await refusalOf(reader.importFrame(AVA, LINK, { by: 'model' }))).toEqual({ kind: 'paused', until: now + 5 * 86400 * 1000, dated: true });
    expect(await refusalOf(reader.readPart(AVA, { fileKey: KEY, nodeId: '1:2', version: '42' }, '1:3', { picture: false, allowance: 3, small: false }))).toMatchObject({ kind: 'paused' });
    expect(tier1()).toBe(calls);
    delete fake.fail.nodes;
    await reader.importFrame(AVA, LINK);
    expect(store.pauses.has('1111')).toBe(false);
  });

  it('keeps a pause Figma gave no date for at most a month, undated; a long wait is cut to 31 days', async () => {
    const { reader, store } = setup();
    fake.fail.nodes = { status: 429, headers: { 'x-figma-rate-limit-type': 'low' } };
    await refusalOf(reader.importFrame(AVA, LINK));
    expect(store.pauses.get('1111')).toEqual({ until: now + 31 * 86400 * 1000, dated: false });
    fake.fail.nodes = { status: 429, headers: { 'x-figma-rate-limit-type': 'low', 'retry-after': String(400 * 86400) } };
    await refusalOf(reader.importFrame(AVA, LINK));
    expect(store.pauses.get('1111')).toEqual({ until: now + 31 * 86400 * 1000, dated: true });
  });

  it('does not pause for a short wait', async () => {
    const { reader, store } = setup();
    fake.fail.nodes = { status: 429, headers: { 'x-figma-rate-limit-type': 'high', 'retry-after': '120' } };
    expect(await refusalOf(reader.importFrame(AVA, LINK))).toEqual({ kind: 'limit', type: 'high', retryAfterSeconds: 120 });
    expect(store.pauses.size).toBe(0);
  });
});

describe('reading a part of an imported frame', () => {
  it('reads it from the kept document at no cost, and its picture for one read, kept after', async () => {
    const { reader } = setup();
    await reader.importFrame(AVA, LINK);
    const before = tier1();
    const part = await reader.readPart(AVA, { fileKey: KEY, nodeId: '1:2', version: '42' }, '1:5', { picture: false, allowance: 3, small: false });
    expect(part.reads).toBe(0);
    expect(part.text).toContain('component "Button/Primary"');
    expect(tier1()).toBe(before);
    const pictured = await reader.readPart(AVA, { fileKey: KEY, nodeId: '1:2', version: '42' }, '1:5', { picture: true, allowance: 3, small: false });
    expect(pictured.reads).toBe(1);
    expect(pictured.picture?.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect((await reader.readPart(AVA, { fileKey: KEY, nodeId: '1:2', version: '42' }, '1:5', { picture: true, allowance: 3, small: false })).reads).toBe(0);
  });

  it('asks Figma for a part the server no longer keeps, within its allowance only', async () => {
    const { reader, cache } = setup();
    await reader.importFrame(AVA, LINK);
    cache.forget(AVA);
    await expect(reader.readPart(AVA, { fileKey: KEY, nodeId: '1:2', version: '42' }, '1:2', { picture: true, allowance: 1, small: false })).rejects.toBeInstanceOf(FigmaAllowanceError);
    const part = await reader.readPart(AVA, { fileKey: KEY, nodeId: '1:2', version: '42' }, '1:2', { picture: false, allowance: 1, small: true });
    expect(part.reads).toBe(1);
    expect(part.text.length).toBeLessThanOrEqual(4000);
  });
});

describe('the cache', () => {
  const key = { userId: AVA, fileKey: KEY, nodeId: '1:2', version: '42' };
  it('trusts no entry it cannot read back', () => {
    const cache = createFigmaCache(root);
    cache.putNodes(key, { name: 'x', version: '42', lastModified: '', nodes: { '1:2': checkoutFrame() } });
    cache.putRender(key, pngOf(4, 4));
    expect(cache.nodes(key)?.version).toBe('42');
    expect(cache.newest(AVA, KEY, '1:2')).toBe('42');
    // Cut short, and not a picture.
    const folder = join(root, '.adminium', 'designer', 'figma', AVA);
    const entry = (dir: string): string => {
      const found = readdirSync(dir, { withFileTypes: true }).find((item) => item.isDirectory());
      return found === undefined ? dir : entry(join(dir, found.name));
    };
    const at = entry(folder);
    writeFileSync(join(at, 'nodes.json'), '{"version":"42","nod');
    writeFileSync(join(at, 'render.png'), 'not a png');
    expect(cache.nodes(key)).toBeNull();
    expect(cache.render(key)).toBeNull();
    // An entry kept for another version, or without the frame, is not this one.
    cache.putNodes(key, { name: 'x', version: '41', lastModified: '', nodes: { '1:2': checkoutFrame() } });
    expect(cache.nodes(key)).toBeNull();
  });

  it('lets the oldest entries go once it is over its size, and forgets a person whole', () => {
    const cache = createFigmaCache(root, { maxBytes: 6000 });
    for (const version of ['1', '2', '3']) {
      now += 1000;
      cache.putRender({ ...key, version }, Buffer.concat([pngOf(4, 4), Buffer.alloc(2500)]));
    }
    expect(cache.render({ ...key, version: '1' })).toBeNull();
    expect(cache.render({ ...key, version: '3' })).not.toBeNull();
    cache.forget(AVA);
    expect(existsSync(join(root, '.adminium', 'designer', 'figma', AVA))).toBe(false);
  });

  it('says whether it outlives a deploy: not on a container’s own disk', () => {
    const devices: Record<string, number> = { '/': 1, '/data': 2, '/app': 1 };
    const deviceOf = (path: string): number | null => devices[path] ?? null;
    expect(cacheOutlivesDeploys('/data/x/figma', { inContainer: true, deviceOf })).toBe(true);
    expect(cacheOutlivesDeploys('/app/x/figma', { inContainer: true, deviceOf })).toBe(false);
    expect(cacheOutlivesDeploys('/app/x/figma', { inContainer: false, deviceOf })).toBe(true);
  });
});

describe('a picture made to fit', () => {
  it('is left alone under the cap, made smaller over it, and refused when it cannot be read', () => {
    const small = pngOf(10, 10);
    expect(fitPicture(small, 1000)).toBe(small);
    const noisy = pngOf(300, 300, true);
    const fitted = fitPicture(noisy, 100_000);
    expect(fitted.length).toBeLessThanOrEqual(100_000);
    expect(() => fitPicture(Buffer.alloc(200_000), 100_000)).toThrow(FigmaError);
  });
});
