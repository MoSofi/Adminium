// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketplace API's wire format as a server reads it: the item lenient,
 * the release strict, one verdict per item.
 */
import { describe, expect, it } from 'vitest';

import { addOnItemWireSchema, appItemWireSchema, MARKETPLACE_FORMAT, parseShelf } from '../src/index.js';

const INTEGRITY = `sha512-${'A'.repeat(86)}==`;

/** An add-on item with every field the site sends today (src/lib/api/marketplace.ts). */
function addOnItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'add-on',
    key: 'add-on-invoices',
    status: 'published',
    availability: 'installable',
    name: { en: 'Invoices', de: 'Rechnungen' },
    tagline: { en: 'Bill your clients' },
    overview: { en: 'Longer words.' },
    category: { en: 'Billing' },
    categoryKey: 'billing',
    author: { name: 'Adminium', url: 'https://adminium.dev' },
    capabilities: ['payments'],
    art: { monogram: 'In', iconName: 'receipt', shots: [] },
    links: { page: 'https://adminium.dev/marketplace/add-on-invoices/', repo: 'https://github.com/x/y' },
    version: '1.0.3',
    firstReleasedAt: '2026-09-01T00:00:00.000Z',
    lastUpdatedAt: '2026-09-20T00:00:00.000Z',
    release: {
      version: '1.0.3',
      integrity: INTEGRITY,
      categories: ['billing'],
      capabilities: ['payments'],
      connect: { kind: 'none' },
      provides: [{ contract: 'invoice-renderer', version: 1 }],
      attaches: [{ app: '*' }],
      network: { allow: [] },
      minAdminiumVersion: '0.3.0',
      publisher: 'Adminium',
    },
    file: { url: 'https://downloads.adminium.dev/add-ons/add-on-invoices/add-on-invoices-1.0.3.tgz', size: 12345, publishedAt: '2026-09-20T00:00:00.000Z' },
    ...over,
  };
}

const shelf = (items: unknown[]) => ({ format: MARKETPLACE_FORMAT, generatedAt: '2026-09-26T12:00:00.000Z', items });

describe('parseShelf', () => {
  it('reads an item the site sends today, dropping the display fields it does not use', () => {
    const parsed = parseShelf(addOnItemWireSchema, shelf([addOnItem()]));
    expect(parsed?.skipped).toEqual([]);
    const item = parsed?.items[0];
    expect(item).toMatchObject({ key: 'add-on-invoices', availability: 'installable', author: { name: 'Adminium' } });
    expect(item?.release?.integrity).toBe(INTEGRITY);
    // Lenient body: fields this reader does not know are stripped, not refused.
    expect(item).not.toHaveProperty('overview');
    expect(item?.file).toEqual({ size: 12345, publishedAt: '2026-09-20T00:00:00.000Z' });
  });

  it('strips a price on the item, and refuses one inside the release', () => {
    const priced = parseShelf(addOnItemWireSchema, shelf([addOnItem({ pricing: { kind: 'one-time', amount: 49 } })]));
    expect(priced?.items).toHaveLength(1);
    expect(priced?.items[0]).not.toHaveProperty('pricing');

    const inRelease = addOnItem();
    (inRelease['release'] as Record<string, unknown>)['price'] = 49;
    const refused = parseShelf(addOnItemWireSchema, shelf([inRelease, addOnItem({ key: 'add-on-other' })]));
    // One item's verdict is its own: the rest of the shelf is still offered.
    expect(refused?.items.map((item) => item.key)).toEqual(['add-on-other']);
    expect(refused?.skipped).toEqual([{ key: 'add-on-invoices', reason: expect.stringContaining('price') as string }]);
  });

  it('reads coming soon and too new as items with no release', () => {
    const parsed = parseShelf(
      addOnItemWireSchema,
      shelf([
        addOnItem({ key: 'add-on-soon', availability: 'coming-soon', release: null, file: null, version: null }),
        addOnItem({ key: 'add-on-new', release: null, file: null, newerRelease: { version: '2.0.0', minAdminiumVersion: '9.0.0' } }),
      ]),
    );
    expect(parsed?.items.map((item) => [item.key, item.availability, item.release, item.newerRelease ?? null])).toEqual([
      ['add-on-soon', 'coming-soon', null, null],
      ['add-on-new', 'installable', null, { version: '2.0.0', minAdminiumVersion: '9.0.0' }],
    ]);
  });

  it('reads an app with the add-ons it needs', () => {
    const parsed = parseShelf(
      appItemWireSchema,
      shelf([
        {
          ...addOnItem(),
          kind: 'app',
          key: 'client-portal',
          art: { tint: '#123456', iconPaths: ['M0 0h1'], shots: [] },
          release: {
            version: '0.2.1',
            integrity: INTEGRITY,
            categories: ['services'],
            capabilities: [],
            publisher: 'Adminium',
            sides: ['staff', 'customer'],
            minAdminiumVersion: '0.3.4',
            addOns: { requires: [{ key: 'add-on-invoices', range: '>=1.0.2', reason: { key: 'x', fallback: 'x' } }], suggests: [], features: [] },
          },
        },
      ]),
    );
    expect(parsed?.skipped).toEqual([]);
    expect(parsed?.items[0]?.release?.addOns.requires[0]).toMatchObject({ key: 'add-on-invoices', range: '>=1.0.2' });
    expect(parsed?.items[0]?.art).toEqual({ tint: '#123456', iconPaths: ['M0 0h1'] });
  });

  it('is null for a document in any other format, the frozen feeds included', () => {
    expect(parseShelf(addOnItemWireSchema, { schemaVersion: 3, generatedAt: 'x', addOns: [] })).toBeNull();
    expect(parseShelf(addOnItemWireSchema, { format: 'adminium-marketplace/2', generatedAt: 'x', items: [] })).toBeNull();
    expect(parseShelf(addOnItemWireSchema, null)).toBeNull();
  });

  it('skips an item with no English name, or of the other kind', () => {
    const parsed = parseShelf(addOnItemWireSchema, shelf([addOnItem({ name: { de: 'Nur Deutsch' } }), { ...addOnItem(), kind: 'app' }]));
    expect(parsed?.items).toEqual([]);
    expect(parsed?.skipped).toHaveLength(2);
  });
});
