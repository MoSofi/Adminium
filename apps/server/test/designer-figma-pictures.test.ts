// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Figma design's own pictures: an import brings them (one Tier 2 call for their addresses, never a
 * counted read, and a download each), kept by the person and the file's version; `add_spots` starts a
 * spot with one by the node id its picture line ends with; and the needs card does not ask how the
 * pages get their pictures when the design brought them.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FigmaPause } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNeedsAsker } from '../src/designer/ask-needs.js';
import { createAttachments, type Attachments } from '../src/designer/attachments.js';
import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { createEventLog } from '../src/designer/events.js';
import { createFigmaCache, type FigmaCache } from '../src/designer/figma/cache.js';
import { createFigmaClient, type FigmaNode } from '../src/designer/figma/client.js';
import { createFigmaReader, FRAME_PICTURES_WAIT_MS, type FigmaReader } from '../src/designer/figma/service.js';
import { figmaPicturesIn } from '../src/designer/figma/tool.js';
import type { FigmaCredential, FigmaTokens } from '../src/designer/figma/tokens.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools } from '../src/designer/tools.js';
import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { checkoutFrame, fakeFigma, jpegOf, pngOf, type FakeFigma } from './figma-fake.js';

const KEY = 'AbCdEf0123456789';
const LINK = { fileKey: KEY, nodeId: '1:2' };
const SESSION = 'ds_000000000000000000000000';
const AVA = 'usr_ava';
const BEN = 'usr_ben';
const HERO = jpegOf('hero');

let root: string;
let fake: FakeFigma;
let cache: FigmaCache;
let reader: FigmaReader;
let attachments: Attachments;
let pauses: Map<string, FigmaPause>;

beforeEach(async () => {
  root = tempProject('adminium-figma-pictures-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps }), io.stderr()).toBe(0);
  fake = fakeFigma();
  fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': checkoutFrame() } });
  fake.fillPictures.set('abc', HERO);
  pauses = new Map();
  const tokens: FigmaTokens = {
    status: async () => ({ connected: true, source: 'mine', handle: null }),
    figmaTokenOf: async (): Promise<FigmaCredential | null> => ({ token: 'figd_good_token_0001', source: 'mine', figmaUserId: null }),
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
  cache = createFigmaCache(root);
  reader = createFigmaReader({ client: createFigmaClient({ allowed: () => true, seams: fake.seams, timeoutMs: 2000 }), cache, tokens });
  attachments = createAttachments(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const tier1 = (): number => fake.calls.nodes + fake.calls.images;
const STAMP = { fileKey: KEY, nodeId: '1:2', version: '42' };

/** The person imports the frame (from the dialog), and its design document is attached with its stamp. */
async function imported(): Promise<void> {
  const done = await reader.importFrame(AVA, LINK);
  attachments.add(SESSION, { filename: 'Checkout — Figma design.md', bytes: Buffer.from(done.outline), imported: { source: 'figma', figma: { ...STAMP, version: done.version, frame: 'Checkout', short: done.short }, label: 'Checkout — Figma design.md' } });
}

describe('an import of a frame', () => {
  it('brings the frame’s own pictures with no counted read, and a second import of the version fetches nothing', async () => {
    const first = await reader.importFrame(AVA, LINK);
    expect(first.pictures).toBe(1);
    expect(first.outline).toContain('picture 1376×480 (fill, wide) · "Hero photo"');
    expect(first.outline).toContain('[1:4]');
    // Two counted reads (the nodes, the render), as before; the pictures' addresses are a Tier 2 call.
    expect(tier1()).toBe(2);
    expect(fake.calls.fills).toBe(1);
    expect(fake.seen.find((call) => call.url.includes('/images') && call.url.includes('/v1/files/'))?.url).toBe(`https://api.figma.com/v1/files/${KEY}/images`);
    // The picture's download carries no token.
    const download = fake.seen.find((call) => call.url.startsWith('https://figma-storage.example/fill/'));
    expect(download?.headers['x-figma-token']).toBeUndefined();

    expect(reader.framePicture(AVA, STAMP, '1:4')).toEqual({ bytes: HERO, mediaType: 'image/jpeg' });
    expect(reader.framePictures(AVA, STAMP)).toBe(1);
    // A node that shows no picture, and another person: nothing.
    expect(reader.framePicture(AVA, STAMP, '1:3')).toBeNull();
    expect(reader.framePicture(BEN, STAMP, '1:4')).toBeNull();

    const again = await reader.importFrame(AVA, LINK);
    expect(again).toMatchObject({ reads: 0, pictures: 1 });
    expect(fake.calls.fills).toBe(1);
  });

  it('still imports when the pictures cannot be had now, pauses nothing, and the next import tries again', async () => {
    fake.fail.fills = { status: 429, headers: { 'x-figma-rate-limit-type': 'low', 'retry-after': '60' } };
    const first = await reader.importFrame(AVA, LINK);
    expect(first.pictures).toBe(0);
    // A Tier 2 limit is not the seat's monthly reads: the Designer's reads go on.
    expect(pauses.size).toBe(0);
    expect(reader.framePicture(AVA, STAMP, '1:4')).toBeNull();
    delete fake.fail.fills;
    expect((await reader.importFrame(AVA, LINK)).pictures).toBe(1);
    expect(fake.calls.fills).toBe(2);
  });

  it('leaves out for good a picture that is no picture, or that Figma no longer has', async () => {
    fake.fillPictures.set('abc', Buffer.from('<html>not a picture</html>'));
    expect((await reader.importFrame(AVA, LINK)).pictures).toBe(0);
    expect(await reader.importFrame(AVA, LINK)).toMatchObject({ pictures: 0, reads: 0 });
    // Kept as missing: not asked again for this version.
    expect(fake.calls.fills).toBe(1);

    fake.files.set(KEY, { name: 'Crispy Bites', version: '43', nodes: { '1:2': checkoutFrame() } });
    fake.fillPictures.set('abc', null);
    expect((await reader.importFrame(AVA, LINK)).pictures).toBe(0);
    expect(await reader.importFrame(AVA, LINK)).toMatchObject({ pictures: 0, reads: 0 });
    expect(fake.calls.fills).toBe(2);
  });

  it('makes a PNG over 5 MB smaller to fit a spot', async () => {
    fake.fillPictures.set('abc', pngOf(1500, 1100, true));
    expect((await reader.importFrame(AVA, LINK)).pictures).toBe(1);
    const kept = reader.framePicture(AVA, STAMP, '1:4');
    expect(kept?.mediaType).toBe('image/png');
    expect(kept?.bytes.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it('fetches only a picture the outline names: one nested past its depth is left alone', async () => {
    const frame = checkoutFrame();
    // Ten frames deep, each with a look of its own: past the outline's depth, a picture at the bottom.
    let deepest: FigmaNode = { id: '8:99', name: 'Deep photo', type: 'RECTANGLE', fills: [{ type: 'IMAGE', scaleMode: 'FILL', imageRef: 'def' }], absoluteBoundingBox: { x: 40, y: 700, width: 200, height: 120 } };
    for (let depth = 10; depth >= 1; depth -= 1) deepest = { id: `8:${String(depth)}`, name: `Level ${String(depth)}`, type: 'FRAME', fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }], absoluteBoundingBox: { x: 40, y: 700, width: 400, height: 300 }, children: [deepest] };
    (frame.document.children ?? []).push(deepest);
    fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': frame } });
    const done = await reader.importFrame(AVA, LINK);
    expect(done.outline).not.toContain('[8:99]');
    expect(done.pictures).toBe(1);
    expect(fake.seen.some((call) => call.url.includes('/fill/def'))).toBe(false);
  });

  it('stops waiting for pictures past its wait, keeps nothing, and the next import tries again', async () => {
    let clock = Date.UTC(2026, 10, 4);
    const slow = createFigmaReader({
      client: createFigmaClient({ allowed: () => true, seams: fake.seams, timeoutMs: 2000 }),
      cache,
      tokens: { status: async () => ({ connected: true, source: 'mine', handle: null }), figmaTokenOf: async () => ({ token: 'figd_good_token_0001', source: 'mine', figmaUserId: null }), save: async () => true, remove: async () => true, pausedFor: async () => null, pause: async () => undefined, unpause: async () => undefined },
      now: () => (clock += FRAME_PICTURES_WAIT_MS + 1000),
    });
    expect((await slow.importFrame(AVA, LINK)).pictures).toBe(0);
    expect(fake.seen.some((call) => call.url.includes('/fill/'))).toBe(false);
    expect((await reader.importFrame(AVA, LINK)).pictures).toBe(1);
  });

  it('asks no addresses for a frame with no picture', async () => {
    const plain = checkoutFrame();
    plain.document.children = (plain.document.children ?? []).filter((child) => child.id !== '1:4');
    fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': plain } });
    expect((await reader.importFrame(AVA, LINK)).pictures).toBe(0);
    expect(fake.calls.fills).toBe(0);
  });
});

describe('add_spots with a picture of the design', () => {
  const spotsFile = (): string => join(root, 'apps', 'repairs', 'assets', 'pictures', 'spots.json');
  const spots = (): Record<string, { label: string; file: string | null; alt: string }> => JSON.parse(readFileSync(spotsFile(), 'utf8')) as never;
  const ctx = (by: string | null): ToolContext => {
    const signal = new AbortController().signal;
    const ask = async (): Promise<CardAnswer> => {
      throw new Error('nothing is asked');
    };
    return {
      session: { id: SESSION, appKey: 'repairs', connectionId: 'env:anthropic' } as DesignerSession,
      turn: 1,
      signal,
      ask,
      handle: { turn: 1, by: { id: by, label: 'Ava' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) },
    };
  };
  const addSpots = (): DesignerTool => {
    const tools = createDesignerTools({ root, version: APP_VERSION, designer: () => ({ store: { messages: () => [] } }) as never, skills: createSkills(), listAddOns: async () => [], mode: 'live', attachments, figma: { reader, cache } }, 'repairs', SESSION);
    return tools.find((tool) => tool.name === 'add_spots') as DesignerTool;
  };

  it('starts a spot with the design’s own picture, and makes one whose picture is not kept a plain frame', async () => {
    await imported();
    const made = await addSpots().run(
      {
        spots: [
          { id: 'hero', label: 'Hero', shape: 'wide', shows: 'the dish', figma: '[1:4]', alt: 'Crispy chicken on a plate' },
          { id: 'team', label: 'Team', shape: 'square', shows: 'the cooks', figma: '1:3' },
        ],
      },
      ctx(AVA),
    );
    expect(made).toMatchObject({ label: 'Named 2 picture spots', facts: { outcome: 'added', count: 2 } });
    expect(made.content).toContain('"hero" (Hero, wide, with the Figma design’s own picture)');
    expect(made.content).toContain('Made without a picture:\n"team": the picture of the Figma design at 1:3 is not kept on this server');
    const hero = spots()['hero'];
    expect(hero).toMatchObject({ file: expect.stringMatching(/^hero-[0-9a-f]{8}\.jpg$/), alt: 'Crispy chicken on a plate' });
    expect(readFileSync(join(root, 'apps', 'repairs', 'assets', 'pictures', hero?.file as string)).equals(HERO)).toBe(true);
    expect(spots()['team']?.file).toBeNull();
  });

  it('reads only the turn’s person’s own import: another person’s turn gets a plain frame', async () => {
    await imported();
    const made = await addSpots().run({ spots: [{ id: 'hero', label: 'Hero', shape: 'wide', figma: '1:4' }] }, ctx(BEN));
    expect(made.content).toContain('Made without a picture');
    expect(spots()['hero']?.file).toBeNull();
  });
});

describe('the needs card, for a design that brought its pictures', () => {
  const wanted = [{ kind: 'package' as const, name: 'date-fns' }];
  const asker = () =>
    createNeedsAsker({
      root,
      version: APP_VERSION,
      newestVersion: async () => '4.1.0',
      install: async () => null,
      designPictures: (sessionId, userId) => figmaPicturesIn({ reader, attachments }, sessionId, userId),
    });
  const asking = (cards: CardRequest[], by: string | null = AVA) => {
    const signal = new AbortController().signal;
    const ask = async (card: CardRequest): Promise<CardAnswer> => {
      cards.push(card);
      return { type: 'needs', accept: [] };
    };
    return { ask, signal, handle: { turn: 1, by: { id: by, label: 'Ava' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) } };
  };

  it('does not ask about pictures, and tells the Designer to start the spots with them', async () => {
    writeFileSync(join(root, 'apps', 'repairs', 'look.json'), JSON.stringify({ skill: 'bold' }));
    await imported();
    const cards: CardRequest[] = [];
    const done = await asker()({ ...asking(cards), session: { id: SESSION } }, 'repairs', wanted);
    expect(done.asked).toBe(true);
    expect((cards[0] as Extract<CardRequest, { type: 'needs' }>).pictures).toBeUndefined();
    expect(done.said).toContain('Pictures: the design imported from Figma brought its own (1).');
    expect(JSON.parse(readFileSync(join(root, 'apps', 'repairs', 'look.json'), 'utf8'))['pictures']).toBeUndefined();
  });

  it('still asks when the design brought none, or the session is not known', async () => {
    writeFileSync(join(root, 'apps', 'repairs', 'look.json'), JSON.stringify({ skill: 'bold' }));
    const cards: CardRequest[] = [];
    await asker()({ ...asking(cards), session: { id: SESSION } }, 'repairs', wanted);
    expect((cards[0] as Extract<CardRequest, { type: 'needs' }>).pictures).toEqual({ preselect: 'placeholders' });

    writeFileSync(join(root, 'apps', 'repairs', 'look.json'), JSON.stringify({ skill: 'bold' }));
    await imported();
    const more: CardRequest[] = [];
    await asker()(asking(more), 'repairs', wanted);
    expect((more[0] as Extract<CardRequest, { type: 'needs' }>).pictures).toEqual({ preselect: 'placeholders' });
  });
});
