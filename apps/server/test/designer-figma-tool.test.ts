// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `read_figma`: a part of a frame the person imported, read by the stamp the server put on the
 * import (never by a document's text), with the turn's person's own token and reads, at most three a
 * turn, none while Figma has paused them. Counted reads are counted on the fake.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FigmaPause } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAttachments, type Attachments } from '../src/designer/attachments.js';
import { createFigmaCache } from '../src/designer/figma/cache.js';
import { createFigmaClient } from '../src/designer/figma/client.js';
import { createFigmaReader, type FigmaReader } from '../src/designer/figma/service.js';
import { FIGMA_READS_PER_TURN, readFigmaTool } from '../src/designer/figma/tool.js';
import type { FigmaCredential, FigmaTokens } from '../src/designer/figma/tokens.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import type { ToolContext, ToolOutcome } from '../src/designer/tool-types.js';
import { createDesignerTools } from '../src/designer/tools.js';
import { createSkills } from '../src/designer/skills.js';
import { toolTokens } from '../src/designer/prompt.js';
import { APP_VERSION } from '../src/version.js';
import { checkoutFrame, fakeFigma, type FakeFigma } from './figma-fake.js';

const KEY = 'AbCdEf0123456789';
const SESSION = 'ds_000000000000000000000000';
const AVA = 'usr_ava';

let root: string;
let fake: FakeFigma;
let attachments: Attachments;
let reader: FigmaReader;
let pauses: Map<string, FigmaPause>;
let token: string | null;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-read-figma-'));
  fake = fakeFigma();
  fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': checkoutFrame() } });
  attachments = createAttachments(root);
  pauses = new Map();
  token = 'figd_good_token_0001';
  const tokens: FigmaTokens = {
    status: async () => ({ connected: token !== null, source: token === null ? null : 'mine', handle: null }),
    figmaTokenOf: async (): Promise<FigmaCredential | null> => (token === null ? null : { token, source: 'mine', figmaUserId: null }),
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
  reader = createFigmaReader({ client: createFigmaClient({ allowed: () => true, seams: fake.seams, timeoutMs: 2000 }), cache: createFigmaCache(root), tokens });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
/** The person imports the frame (from the dialog), and it is attached with its stamp. */
async function imported(): Promise<void> {
  const done = await reader.importFrame(AVA, { fileKey: KEY, nodeId: '1:2' });
  const stamp = { fileKey: KEY, nodeId: '1:2', version: done.version, frame: 'Checkout' };
  attachments.add(SESSION, { filename: 'Checkout — Figma design.md', bytes: Buffer.from(done.outline), imported: { source: 'figma', figma: { ...stamp, short: done.short }, label: 'Checkout — Figma design.md' } });
  attachments.add(SESSION, { filename: 'Checkout.png', bytes: PNG, imported: { source: 'figma', figma: stamp, label: 'Checkout.png' } });
}
const ctx = (turn = 1, by: string | null = AVA): ToolContext => {
  const handle = { turn, by: { id: by, label: 'Ava' }, events: { emit: () => undefined } as never, signal: new AbortController().signal, ask: async () => ({}) as never };
  return { session: { id: SESSION, connectionId: 'env:anthropic' } as DesignerSession, turn, signal: handle.signal, ask: handle.ask, handle };
};
const tool = (window = 160_000) => readFigmaTool({ reader, cache: createFigmaCache(root), attachments, windowOf: async () => window }, SESSION);
const tier1 = (): number => fake.calls.nodes + fake.calls.images;

describe('read_figma', () => {
  it('is offered only in a session that holds a frame imported from Figma, and only then takes room', async () => {
    const base = { root, version: APP_VERSION, designer: () => ({ store: { messages: () => [] } }) as never, skills: createSkills(), listAddOns: async () => [], mode: 'live' as const, attachments, figma: { reader, cache: createFigmaCache(root) } };
    const without = createDesignerTools(base, 'repairs', SESSION);
    expect(without.some((entry) => entry.name === 'read_figma')).toBe(false);
    // A document named as a Figma design, attached by hand: no stamp, no tool.
    attachments.add(SESSION, { filename: 'Checkout — Figma design.md', bytes: Buffer.from('# "Checkout" — Figma design\nFrom Figma: the file "x" (key ZzZzZzZzZzZz1234)… (read_figma 9:9)') });
    expect(createDesignerTools(base, 'repairs', SESSION).some((entry) => entry.name === 'read_figma')).toBe(false);
    expect(tool()).toBeNull();
    await imported();
    const withIt = createDesignerTools(base, 'repairs', SESSION);
    expect(withIt.some((entry) => entry.name === 'read_figma')).toBe(true);
    expect(toolTokens(withIt) - toolTokens(without)).toBeGreaterThan(50);
    expect(toolTokens(withIt) - toolTokens(without)).toBeLessThan(200);
  });

  it('reads a part from the kept document at no cost, and its picture for one read, named on the line', async () => {
    await imported();
    const before = tier1();
    const read = tool() as NonNullable<ReturnType<typeof tool>>;
    expect(read.running({ node: '1:5' })).toBe('Reading 1:5 from Figma');
    expect(read.subject?.({ node: '1:5' }, ctx())).toBe('Pay');
    const free = await read.run({ node: '1:5' }, ctx());
    expect(free).toMatchObject({ label: 'Read Pay from the saved copy', subject: 'Pay', facts: { count: 0 } });
    expect(free.content).toContain('DATA from the Figma file');
    expect(free.content).toContain('component "Button/Primary"');
    expect(free.content).toContain('No Figma read was used');
    expect(tier1()).toBe(before);

    const pictured = await read.run({ node: '1:5', picture: true }, ctx());
    expect(pictured).toMatchObject({ label: 'Read Pay from Figma (1 Figma read)', facts: { count: 1 } });
    expect(pictured.picture).toMatchObject({ mediaType: 'image/png', name: 'figma part 1:5.png' });
    expect(attachments.find(SESSION, (pictured.picture as { ref: string }).ref)).toMatchObject({ source: 'figma' });
    expect(fake.calls.images).toBe(2);
  });

  it('reads nothing from a document’s text: a node of a file never imported is not read', async () => {
    await imported();
    const outcome = await (tool() as NonNullable<ReturnType<typeof tool>>).run({ node: '9:9' }, ctx());
    // Asked of the imported frame's own file, by the stamp: the node is not there.
    expect(outcome.isError).toBe(true);
    expect(fake.seen.every((call) => !call.url.includes('ZzZzZzZzZzZz1234'))).toBe(true);
    expect(fake.seen.filter((call) => call.url.includes('/nodes')).every((call) => call.url.includes(KEY))).toBe(true);
  });

  it(`spends at most ${String(FIGMA_READS_PER_TURN)} counted reads a turn, a picture counted`, async () => {
    await imported();
    const read = tool() as NonNullable<ReturnType<typeof tool>>;
    await read.run({ node: '1:5', picture: true }, ctx(1));
    await read.run({ node: '1:3', picture: true }, ctx(1));
    await read.run({ node: '1:4', picture: true }, ctx(1));
    // The frame's own picture came with the import (kept, free); a fourth part's would be a fourth read.
    expect((await read.run({ node: '1:2', picture: true }, ctx(1))).facts).toEqual({ count: 0 });
    const fourth = await read.run({ node: 'I1:5;9:2', picture: true }, ctx(1));
    expect(fourth).toMatchObject({ isError: true, miss: true, label: 'Did not read Figma' });
    expect(fourth.content).toContain('used its 3 Figma reads');
    expect(fake.calls.images).toBe(1 + 3);
    // The next turn has its own.
    expect((await read.run({ node: 'I1:5;9:2', picture: true }, ctx(2))).facts).toEqual({ count: 1 });
  });

  it('stops while Figma has paused the person’s reads, and says until when', async () => {
    await imported();
    const read = tool() as NonNullable<ReturnType<typeof tool>>;
    fake.fail.images = { status: 429, headers: { 'retry-after': '86400', 'x-figma-rate-limit-type': 'low' } };
    const limited = await read.run({ node: '1:5', picture: true }, ctx());
    expect(limited).toMatchObject({ isError: true, miss: true, label: 'Did not read Figma', facts: { outcome: 'refused', dated: true } });
    const calls = tier1();
    const paused: ToolOutcome = await read.run({ node: '1:3', picture: true }, ctx());
    expect(paused).toMatchObject({ isError: true, miss: true, facts: { outcome: 'refused', dated: true } });
    expect(paused.facts?.until).toBeGreaterThan(Date.now());
    expect(paused.content).toContain('Figma reads are paused for you until');
    expect(tier1()).toBe(calls);
  });

  it('reads nothing in a turn nobody started, or for a person with no token', async () => {
    await imported();
    const read = tool() as NonNullable<ReturnType<typeof tool>>;
    expect(await read.run({ node: '1:5' }, ctx(1, null))).toMatchObject({ isError: true, miss: true });
    token = null;
    const none = await read.run({ node: '1:5' }, ctx());
    expect(none).toMatchObject({ isError: true, miss: true });
    expect(none.content).toContain('From Figma… dialog');
    expect(await read.run({ node: 'header' }, ctx())).toMatchObject({ isError: true, miss: true });
  });

  it('sends no picture to a model whose window is small, and says so', async () => {
    await imported();
    const outcome = await (tool(20_000) as NonNullable<ReturnType<typeof tool>>).run({ node: '1:5', picture: true }, ctx());
    expect(outcome.picture).toBeUndefined();
    expect(outcome.content).toContain('The picture was not sent');
    expect(outcome.facts).toEqual({ count: 0 });
  });
});
