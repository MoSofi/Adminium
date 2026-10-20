// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Figma's REST API as the Designer reads it, against a fake reached through the safe fetch's seams.
 */
import { describe, expect, it } from 'vitest';

import { createFigmaClient, FigmaError, figmaWords, type FigmaRefusal } from '../src/designer/figma/client.js';
import { checkoutFrame, fakeFigma, pngOf } from './figma-fake.js';

const TOKEN = 'figd_good_token_0001';
const KEY = 'AbCdEf0123456789';

const setup = (allowed = true) => {
  const fake = fakeFigma();
  fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': checkoutFrame() } });
  const client = createFigmaClient({ allowed: () => allowed, seams: fake.seams, timeoutMs: 2000 });
  return { fake, client };
};

const refusalOf = async (work: Promise<unknown>): Promise<FigmaRefusal | null> => {
  try {
    await work;
    return null;
  } catch (error) {
    if (error instanceof FigmaError) return error.refusal;
    throw error;
  }
};

describe('the Figma client', () => {
  it('sends the token to Figma’s API only, and reads who it is, the version, the nodes and a render', async () => {
    const { fake, client } = setup();
    expect(await client.me(TOKEN)).toEqual({ id: '1111', handle: 'ava.reyes' });
    expect(await client.meta(TOKEN, KEY)).toMatchObject({ name: 'Crispy Bites', version: '42' });
    const nodes = await client.nodes(TOKEN, KEY, ['1:2', '7:7']);
    expect(nodes.version).toBe('42');
    expect(nodes.nodes['1:2']?.document.name).toBe('Checkout');
    expect(nodes.nodes['7:7']).toBeNull();
    const url = await client.render(TOKEN, KEY, '1:2', 1.25);
    expect(url).toMatch(/^https:\/\/figma-storage\.example\//);
    const png = await client.download(url, 5 * 1024 * 1024);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(fake.calls).toEqual({ me: 1, meta: 1, nodes: 1, images: 1, download: 1 });
    // Every API call carried the token; the storage download carried none.
    const api = fake.seen.filter((call) => call.url.startsWith('https://api.figma.com/'));
    expect(api.every((call) => call.headers['x-figma-token'] === TOKEN)).toBe(true);
    const download = fake.seen.find((call) => call.url.startsWith('https://figma-storage.example/'));
    expect(download?.headers['x-figma-token']).toBeUndefined();
    expect(Object.keys(download?.headers ?? {}).some((name) => /figma|authorization|cookie/i.test(name))).toBe(false);
    // Each path part is encoded on its own; the ids are asked as the API writes them.
    expect(fake.seen.find((call) => call.url.includes('/nodes'))?.url).toBe(`https://api.figma.com/v1/files/${KEY}/nodes?ids=1%3A2,7%3A7`);
    expect(fake.seen.find((call) => call.url.includes('/v1/images/'))?.url).toBe(`https://api.figma.com/v1/images/${KEY}?ids=1%3A2&format=png&scale=1.25`);
  });

  it('refuses at once when network features are off, and calls nothing', async () => {
    const { fake, client } = setup(false);
    expect(await refusalOf(client.me(TOKEN))).toEqual({ kind: 'network-off' });
    expect(await refusalOf(client.download('https://figma-storage.example/x.png', 1000))).toEqual({ kind: 'network-off' });
    expect(fake.seen).toHaveLength(0);
  });

  it('tells a dead token from a file the account cannot open', async () => {
    const { fake, client } = setup();
    expect(await refusalOf(client.nodes('figd_dead_token_0000', KEY, ['1:2']))).toEqual({ kind: 'token' });
    fake.access.set(KEY, new Set(['someone-else']));
    expect(await refusalOf(client.nodes(TOKEN, KEY, ['1:2']))).toEqual({ kind: 'no-access' });
    expect(await refusalOf(client.meta(TOKEN, 'ZzZzZzZzZz12'))).toEqual({ kind: 'no-access' });
    expect(await refusalOf(client.me('figd_dead_token_0000'))).toEqual({ kind: 'no-access' });
  });

  it('reads Figma’s limit: the seat’s monthly reads, or a short wait, with the time it says', async () => {
    const { fake, client } = setup();
    fake.fail.nodes = { status: 429, headers: { 'retry-after': '86400', 'x-figma-rate-limit-type': 'low' } };
    expect(await refusalOf(client.nodes(TOKEN, KEY, ['1:2']))).toEqual({ kind: 'limit', type: 'low', retryAfterSeconds: 86400 });
    fake.fail.nodes = { status: 429, headers: { 'x-figma-rate-limit-type': 'high', 'retry-after': '240' } };
    expect(await refusalOf(client.nodes(TOKEN, KEY, ['1:2']))).toEqual({ kind: 'limit', type: 'high', retryAfterSeconds: 240 });
    // No type, no time: taken as the seat's own limit, with no date.
    fake.fail.nodes = { status: 429 };
    expect(await refusalOf(client.nodes(TOKEN, KEY, ['1:2']))).toEqual({ kind: 'limit', type: 'low', retryAfterSeconds: null });
    fake.fail.nodes = { status: 500 };
    expect(await refusalOf(client.nodes(TOKEN, KEY, ['1:2']))).toEqual({ kind: 'unreachable' });
  });

  it('refuses a render Figma could not draw, a picture that is not a PNG, and one over the cap', async () => {
    const { fake, client } = setup();
    fake.fail.images = 'null-image';
    expect(await refusalOf(client.render(TOKEN, KEY, '1:2', 1))).toEqual({ kind: 'render-failed' });
    fake.picture = Buffer.from('<html>not a picture</html>');
    expect(await refusalOf(client.download('https://figma-storage.example/x.png', 1000))).toEqual({ kind: 'render-failed' });
    fake.picture = pngOf(64, 64, true);
    expect(await refusalOf(client.download('https://figma-storage.example/x.png', 1000))).toEqual({ kind: 'too-large' });
  });

  it('gives up on a call that does not answer, and says so', async () => {
    const fake = fakeFigma();
    fake.fail.me = 'hang';
    const client = createFigmaClient({ allowed: () => true, seams: fake.seams, timeoutMs: 50 });
    expect(await refusalOf(client.me(TOKEN))).toEqual({ kind: 'unreachable' });
  });

  it('cuts the handle it shows to one plain line of 120 characters', async () => {
    const { fake, client } = setup();
    fake.tokens.set('figd_long_handle_01', { id: '2', handle: `ava\n\u202e${'x'.repeat(300)}` });
    const { handle } = await client.me('figd_long_handle_01');
    expect(handle.length).toBeLessThanOrEqual(120);
    expect(handle).not.toMatch(/[\n\u202e]/);
  });

  it('says each refusal in one sentence', () => {
    const now = Date.UTC(2026, 9, 20);
    expect(figmaWords({ kind: 'limit', type: 'low', retryAfterSeconds: 12 * 86400 }, now)).toBe("Figma's limit for your seat is used up for now. You can read again on 2026-11-01.");
    expect(figmaWords({ kind: 'limit', type: 'low', retryAfterSeconds: null }, now)).toContain('next month');
    expect(figmaWords({ kind: 'limit', type: 'high', retryAfterSeconds: 240 }, now)).toBe('Figma asked us to wait. Try again in 4 minutes.');
    expect(figmaWords({ kind: 'token' })).toBe('Your Figma token no longer works. Paste a new one.');
  });
});
