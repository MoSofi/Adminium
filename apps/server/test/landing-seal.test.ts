// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The publish seal of a landing page, by itself (`landing/seal.ts`): which
 * writes publish, what each must leave, when the engine says the page was
 * published, and the assistant's door. The whole server's seal, on three
 * engines, is in `landing-seal-server.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { LANDING_SEALED_COLUMNS, landingPagesTable, sealLandingWrite, type LandingSealInput } from '../src/landing/seal.js';
import type { AddOnInstalls } from '../src/apps/table-ref.js';

const CLEAN = { v: 1, title: 'Open day', description: 'Sit in the new booths.', blocks: [{ id: 'h', kind: 'heading', text: 'Open day at our Leeds showroom' }] };
const MARKED = { ...CLEAN, blocks: [{ ...CLEAN.blocks[0], milo: true }] };
const NOW = '2026-11-18T10:00:00.000Z';
const STORED = { id: 1, slug: 'open-day', state: 'draft', published: null, published_at: null };

/** One write, sealed: by default an update of the stored draft, at a free slug, by a person. */
const seal = (values: Record<string, unknown>, more: Partial<LandingSealInput> = {}) =>
  sealLandingWrite({ action: 'update', table: 'main.lp_pages', values, stored: async () => STORED, assistant: false, now: () => NOW, slugTaken: async () => false, ...more });
const reasonOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    return 'written';
  } catch (error) {
    return (error as { details?: { reason?: unknown } }).details?.reason;
  }
};

describe('a write that publishes a page', () => {
  it('writes a clean page live, and the engine says when', async () => {
    expect(await seal({ state: 'live', published: CLEAN })).toEqual({ state: 'live', published: CLEAN, published_at: NOW });
    expect(await seal({ slug: 'showroom', state: 'live', published: CLEAN }, { action: 'create', stored: async () => null })).toMatchObject({ published_at: NOW });
    // A create is judged on what it sends alone: no stored row is read.
    expect(await reasonOf(seal({ state: 'live', published: CLEAN }, { action: 'create', stored: async () => STORED }))).toBe('landing-slug');
  });

  it('drops the client\'s own "published at"', async () => {
    expect(await seal({ state: 'live', published: CLEAN, published_at: '1999-01-01T00:00:00Z' })).toEqual({ state: 'live', published: CLEAN, published_at: NOW });
    // Re-sent unchanged (its keys in another order, or as stored text): it was not published again.
    const live = { ...STORED, state: 'live', published: JSON.stringify(CLEAN), published_at: '2026-11-01T00:00:00Z' };
    const reordered = { blocks: CLEAN.blocks, description: CLEAN.description, title: CLEAN.title, v: 1 };
    expect(await seal({ published: reordered, published_at: NOW }, { stored: async () => live })).toEqual({ published: reordered });
  });

  it('refuses a published copy that is not a whole page', async () => {
    expect(await reasonOf(seal({ state: 'live', published: { ...CLEAN, blocks: [{ id: 'x', kind: 'footer' }] } }))).toBe('landing-unparsable');
    expect(await reasonOf(seal({ state: 'live', published: '{"v":1,' }))).toBe('landing-unparsable');
    expect(await reasonOf(seal({ published: null }))).toBe('landing-unparsable');
    // Live with nothing ever published.
    expect(await reasonOf(seal({ state: 'live' }))).toBe('landing-unparsable');
    // A client that names when it was published, on a page with no copy.
    expect(await reasonOf(seal({ published_at: NOW }))).toBe('landing-unparsable');
  });

  it('refuses a copy that still carries the assistant\'s mark', async () => {
    expect(await reasonOf(seal({ state: 'live', published: MARKED }))).toBe('landing-marked');
    // …even one written without going live.
    expect(await reasonOf(seal({ published: MARKED }))).toBe('landing-marked');
    // …or a stored marked copy put live.
    expect(await reasonOf(seal({ state: 'live' }, { stored: async () => ({ ...STORED, published: MARKED }) }))).toBe('landing-marked');
  });

  it('refuses a reserved address, one that breaks the rule, and one another page holds', async () => {
    for (const slug of ['api', 'login', 'sign-in', 'Open-Day', '']) expect(await reasonOf(seal({ state: 'live', published: CLEAN, slug })), slug).toBe('landing-slug');
    expect(await reasonOf(seal({ state: 'live', published: CLEAN }, { slugTaken: async () => true }))).toBe('landing-slug');
    // A live page moved to a taken address.
    const live = { ...STORED, state: 'live', published: CLEAN };
    expect(await reasonOf(seal({ slug: 'assets' }, { stored: async () => live }))).toBe('landing-slug');
    // The page's own row is not another page.
    const seen: unknown[] = [];
    await seal({ state: 'live', published: CLEAN }, { slugTaken: async (slug, own) => (seen.push([slug, own]), false) });
    expect(seen).toEqual([['open-day', STORED]]);
  });

  it('lets a page go off or back to a draft, and a draft change anything of its own', async () => {
    expect(await seal({ state: 'off' }, { stored: async () => ({ ...STORED, state: 'live', published: MARKED, slug: 'api' }) })).toEqual({ state: 'off' });
    expect(await seal({ state: 'draft' })).toEqual({ state: 'draft' });
    expect(await seal({ name: 'Open day (copy)', draft: MARKED, slug: 'api' })).toEqual({ name: 'Open day (copy)', draft: MARKED, slug: 'api' });
    // A live page's own words, not its address: nothing is judged.
    let read = false;
    expect(await seal({ name: 'Renamed' }, { stored: async () => ((read = true), { ...STORED, state: 'live' }) })).toEqual({ name: 'Renamed' });
    expect(read).toBe(false);
  });
});

describe('the assistant\'s door', () => {
  it('names none of the columns that publish a page, whatever it sends', async () => {
    for (const column of LANDING_SEALED_COLUMNS) {
      const value = column === 'state' ? 'draft' : column === 'published' ? CLEAN : NOW;
      expect(await reasonOf(seal({ [column]: value }, { assistant: true })), column).toBe('landing-assistant');
    }
    expect(await reasonOf(seal({ state: 'off' }, { assistant: true, action: 'create', stored: async () => null }))).toBe('landing-assistant');
  });

  it('writes a draft, with its marks', async () => {
    expect(await seal({ name: 'Open day', draft: MARKED }, { assistant: true })).toEqual({ name: 'Open day', draft: MARKED });
  });
});

describe('which table is sealed', () => {
  const installs = (manifests: Record<string, Record<string, unknown>>, tables: Record<string, string>): AddOnInstalls =>
    ({
      keys: () => Object.keys(manifests),
      installed: (_connection: string, key: string) => (manifests[key] === undefined ? null : { manifest: manifests[key] }),
      tableOf: (_connection: string, key: string, ref: string) => tables[`${key}:${ref}`] ?? null,
    }) as unknown as AddOnInstalls;
  const landing = { kind: 'add-on', addOn: { landing: { pages: 'pages', funnels: 'funnels' } } };

  it('is the pages table a landing add-on declares, and neither its funnels nor another add-on\'s table', () => {
    const at = installs({ lp: landing, other: { kind: 'add-on', addOn: {} } }, { 'lp:pages': 'main.lp_pages', 'lp:funnels': 'main.lp_funnels', 'other:pages': 'main.other_pages' });
    expect(landingPagesTable(at, 'conn', 'main.lp_pages')).toBe(true);
    expect(landingPagesTable(at, 'conn', 'main.lp_funnels')).toBe(false);
    expect(landingPagesTable(at, 'conn', 'main.other_pages')).toBe(false);
  });
});
