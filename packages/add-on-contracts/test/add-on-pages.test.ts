// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addOn.pages` and `addOn.navGroups` — 51a.
 *
 * Two things are being pinned here, and the second is the one that rots. The
 * first is that the new rules refuse what they say they refuse. The second is
 * that a manifest written before any of this existed still validates: every
 * field added here is optional, and the proof is a block with none of them.
 */
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_NAV_GROUP_KEYS,
  DEFAULT_NAV_GROUP,
  HOST_API_VERSION,
  addOnBlockSchema,
} from '../src/index.js';

/** A wave-4 block: no pages, no groups, no hostApi. */
const LEGACY_BLOCK = {
  attaches: [{ app: 'printing', range: '^1.0.0' }],
  slots: [{ slot: 'order.dispatch.actions', client: 'client/dispatch.js', order: 10 }],
  connect: { kind: 'api-key' },
};

const PAGE = {
  ref: 'documents',
  title: { key: 'addon.invoices.nav', fallback: 'Invoices' },
  icon: 'file-text',
  client: 'dist/pages/invoices.js',
  nav: { group: 'library', order: 20, adminOnly: true },
};

const withPages = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...LEGACY_BLOCK,
  hostApi: HOST_API_VERSION,
  pages: [PAGE],
  ...over,
});

describe('back-compatibility', () => {
  it('validates a block that declares none of the new fields', () => {
    const result = addOnBlockSchema.safeParse(LEGACY_BLOCK);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('leaves pages, navGroups and hostApi absent rather than defaulted', () => {
    const parsed = addOnBlockSchema.parse(LEGACY_BLOCK);
    expect(parsed.pages).toBeUndefined();
    expect(parsed.navGroups).toBeUndefined();
    expect(parsed.hostApi).toBeUndefined();
  });
});

describe('a page', () => {
  it('validates with a built-in group', () => {
    const result = addOnBlockSchema.safeParse(withPages());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('lands in Library when it asks for no group (the owner’s ruling)', () => {
    const parsed = addOnBlockSchema.parse(
      withPages({ pages: [{ ...PAGE, nav: { order: 20 } }] }),
    );
    expect(parsed.pages?.[0]?.nav?.group).toBe(DEFAULT_NAV_GROUP);
    expect(DEFAULT_NAV_GROUP).toBe('library');
  });

  it('may omit nav entirely, which means routable but unlisted', () => {
    const parsed = addOnBlockSchema.parse(withPages({ pages: [{ ...PAGE, nav: undefined }] }));
    expect(parsed.pages?.[0]?.nav).toBeUndefined();
  });

  it('is refused when its group is neither built in nor declared', () => {
    const result = addOnBlockSchema.safeParse(
      withPages({ pages: [{ ...PAGE, nav: { group: 'documents', order: 1 } }] }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('neither built in nor declared');
  });

  it('is refused when two pages share a ref', () => {
    const result = addOnBlockSchema.safeParse(withPages({ pages: [PAGE, { ...PAGE }] }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate page ref');
  });

  it('is refused when the block declares pages but no hostApi', () => {
    const result = addOnBlockSchema.safeParse(withPages({ hostApi: undefined }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('hostApi');
  });

  it('is refused at a hostApi version that does not exist', () => {
    expect(addOnBlockSchema.safeParse(withPages({ hostApi: 2 })).success).toBe(false);
  });
});

describe('a declared nav group', () => {
  const GROUP = { key: 'documents', label: { key: 'addon.invoices.group', fallback: 'Documents' }, order: 10 };
  const grouped = (over: Record<string, unknown> = {}): Record<string, unknown> =>
    withPages({
      pages: [{ ...PAGE, nav: { group: 'documents', order: 1 } }],
      navGroups: [GROUP],
      ...over,
    });

  it('validates when one of this add-on’s pages uses it', () => {
    const result = addOnBlockSchema.safeParse(grouped());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('carries its own label, so the engine owns no key for it', () => {
    const parsed = addOnBlockSchema.parse(grouped());
    expect(parsed.navGroups?.[0]?.label.fallback).toBe('Documents');
  });

  it('is refused when it shadows a built-in group', () => {
    const result = addOnBlockSchema.safeParse(
      grouped({
        pages: [{ ...PAGE, nav: { group: 'library', order: 1 } }],
        navGroups: [{ ...GROUP, key: 'library' }],
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('built-in');
  });

  it('is refused when no page uses it', () => {
    const result = addOnBlockSchema.safeParse(grouped({ pages: [PAGE] }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('used by none');
  });

  it('is refused when declared twice', () => {
    const result = addOnBlockSchema.safeParse(grouped({ navGroups: [GROUP, { ...GROUP }] }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate nav group key');
  });

  it('may hold several pages, which is the point of declaring one', () => {
    const result = addOnBlockSchema.safeParse(
      grouped({
        pages: [
          { ...PAGE, ref: 'documents', nav: { group: 'documents', order: 1 } },
          { ...PAGE, ref: 'templates', nav: { group: 'documents', order: 2 } },
        ],
      }),
    );
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('the built-in group list', () => {
  it('is the five the rail has always had, in rail order', () => {
    // Moving this is the deliberate act. 51b rewires the server's and the
    // dashboard's copies to import THIS list; a test at each end holds them
    // equal until then.
    expect([...BUILTIN_NAV_GROUP_KEYS]).toEqual([
      'workspace',
      'library',
      'planning',
      'people',
      'account',
    ]);
  });
});
