// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Figma's real API, read once, to check what the fakes assume (the provider-fakes lesson: a stubbed
 * fetch never sees the real one change). Skipped unless `FIGMA_SMOKE_TOKEN` and `FIGMA_SMOKE_LINK`
 * are set in this process's own environment: never in a `.env` other tests read. CI has neither.
 *
 * It spends two of the token's Figma reads (the frame's nodes, its picture): on a View or Collab seat
 * that is two of twenty a month. Run it by hand, with your own token and a frame of yours:
 *
 *   FIGMA_SMOKE_TOKEN=figd_… FIGMA_SMOKE_LINK='https://www.figma.com/design/…?node-id=…' \
 *     pnpm --filter @adminium/server exec vitest run test/figma.live.smoke.test.ts
 *
 * It prints the file's version and when it was last changed. Run it again after a saved edit in
 * Figma: whether the version moves on every saved edit is not documented, and this is how it is learnt.
 */
import { describe, expect, it } from 'vitest';

import { createFigmaClient } from '../src/designer/figma/client.js';
import { distil, OUTLINE_LONG_CHARS, OUTLINE_SHORT_CHARS } from '../src/designer/figma/distil.js';
import { parseFigmaLink } from '../src/designer/figma/link.js';

const TOKEN = process.env['FIGMA_SMOKE_TOKEN'] ?? '';
const LINK = process.env['FIGMA_SMOKE_LINK'] ?? '';

describe.skipIf(TOKEN === '' || LINK === '')('Figma, live', () => {
  it('answers in the shapes the Designer reads', { timeout: 120_000 }, async () => {
    const parsed = parseFigmaLink(LINK);
    expect(parsed.ok, 'FIGMA_SMOKE_LINK is a link to a frame').toBe(true);
    if (!parsed.ok) return;
    const { fileKey, nodeId } = parsed.link;
    const client = createFigmaClient({ allowed: () => true, timeoutMs: 60_000 });

    const who = await client.me(TOKEN);
    expect(who.id).toMatch(/\S/);
    expect(who.handle.length).toBeGreaterThan(0);

    const meta = await client.meta(TOKEN, fileKey);
    expect(meta.version).toMatch(/\S/);
    console.log(`[figma smoke] ${meta.name}: version ${meta.version}, last changed ${meta.lastModified}`);

    const nodes = await client.nodes(TOKEN, fileKey, [nodeId]);
    const answer = nodes.nodes[nodeId];
    expect(answer, 'the frame is in the file').not.toBeNull();
    if (answer === null || answer === undefined) return;
    expect(answer.document.id).toBe(nodeId);
    expect(typeof answer.document.name).toBe('string');
    expect(answer.document['absoluteBoundingBox']).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    // The nodes answer's version is the one the cache keys by: it is the file's.
    console.log(`[figma smoke] nodes answered version ${nodes.version} (meta said ${meta.version})`);

    const long = distil({ answer, file: { name: nodes.name, key: fileKey, version: nodes.version }, maxChars: OUTLINE_LONG_CHARS });
    const short = distil({ answer, file: { name: nodes.name, key: fileKey, version: nodes.version }, maxChars: OUTLINE_SHORT_CHARS });
    expect(long.text.length).toBeLessThanOrEqual(OUTLINE_LONG_CHARS);
    expect(short.text.length).toBeLessThanOrEqual(OUTLINE_SHORT_CHARS);

    const box = answer.document['absoluteBoundingBox'] as { width: number; height: number };
    const url = await client.render(TOKEN, fileKey, nodeId, Math.min(2, 2000 / Math.max(box.width, box.height)));
    // Figma's storage, on its own host: fetched with no token.
    expect(new URL(url).hostname).not.toBe('api.figma.com');
    console.log(`[figma smoke] the render is served from ${new URL(url).hostname}`);
    const png = await client.download(url, 24 * 1024 * 1024);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    console.log(`[figma smoke] the render is ${String(png.length)} bytes`);
  });
});
