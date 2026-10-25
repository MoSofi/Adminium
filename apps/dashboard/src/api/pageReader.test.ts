// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page document's reader is a chunk of its own (it is zod): the first
 * paint holds only `pageReader.ts`, which fetches it. Each case starts from a
 * fresh module graph, so the reader has NOT been handed in yet, as on a real
 * first load.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeCrudEnvelope } from '../test/fixtures.js';

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('loadPageReader', () => {
  it('fetches the reader once and hands the same one to every caller', async () => {
    const { loadPageReader } = await import('./pageReader.js');
    const [first, second] = await Promise.all([loadPageReader(), loadPageReader()]);
    expect(first).toBe(second);
    expect(await loadPageReader()).toBe(first);
    expect(first.parsePageDocument(makeCrudEnvelope()).status).toBe('ok');
    expect(first.parsePageDocument({ ...makeCrudEnvelope(), v: 99 }).status).toBe('too-new');
  });

  it('is what a page query parses with, on a load where nothing else fetched it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: makeCrudEnvelope(), revision: 3 })));
    const { pageQuery } = await import('./pages.js');
    const { queryFn } = pageQuery('page_customers');
    if (queryFn === undefined) throw new Error('queryFn missing');
    const result = await queryFn({} as never);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.revision).toBe(3);
  });
});
