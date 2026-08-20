// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Manifest spec v1 validation (13-marketplace.md §2): a valid ecommerce-shop
 * manifest round-trips, and every documented rule rejects.
 */
import { describe, expect, it } from 'vitest';

import { compareSemver, validateManifest, parseManifest } from '../src/index.js';

/** A minimal-but-complete valid manifest, shaped after the §2 ecommerce-shop example. */
function validManifest(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    key: 'ecommerce-shop',
    name: 'Jacky’s Storefront',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'MIT',
    description: { key: 'shop.description', fallback: 'A small storefront.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '1.0.0', requires: ['realtime'] },
    requiredSchema: {
      tables: [
        {
          ref: 'products',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'name', type: 'text', semantic: 'name' },
            { ref: 'price', type: 'money', semantic: 'money' },
            { ref: 'status', type: 'enum', enum: ['draft', 'live'] },
            { ref: 'category_id', type: 'fk', references: 'categories' },
          ],
        },
      ],
    },
    pages: [
      {
        ref: 'catalog',
        template: 'page-master-detail',
        title: { key: 'shop.catalog', fallback: 'Catalog' },
        nav: { group: 'manifest:ecommerce-shop', icon: 'shopping-bag', order: 10 },
      },
    ],
    settings: [
      { key: 'store_name', type: 'string', required: true, default: '' },
      { key: 'stripe_secret', type: 'string', secret: true },
      { key: 'currency', type: 'enum', enum: ['usd', 'eur'], default: 'usd' },
    ],
    capabilities: ['realtime', 'payments'],
    frontends: [
      {
        side: 'customer',
        kind: 'spa',
        entry: 'index.html',
        // VITE_-prefixed: only those reach browser code under Vite, which is
        // why 13 §2.12.1's "frozen" bare names were unimplementable as written.
        env: {
          VITE_ADMINIUM_API_BASE_URL: { required: true, example: 'https://x.adminium.app/api/v1' },
          VITE_ADMINIUM_PUBLISHABLE_KEY: { required: true },
        },
        routes: { shop: 'Shop', cart: 'Cart' },
      },
    ],
  };
}

describe('validateManifest — happy path', () => {
  it('accepts a well-formed first-party manifest', () => {
    const result = validateManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.key).toBe('ecommerce-shop');
      expect(result.manifest.requiredSchema.tables[0]?.columns).toHaveLength(5);
    }
  });

  it('parseManifest returns the typed manifest for a valid input', () => {
    expect(parseManifest(validManifest()).version).toBe('1.0.0');
  });
});

describe('validateManifest — identity & policy', () => {
  it('rejects a bad key shape', () => {
    const m = { ...validManifest(), key: 'Not-Valid' };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'key')).toBe(true);
  });

  it('rejects a non-adminium publisher in v1', () => {
    const m = { ...validManifest(), publisher: { id: 'acme', name: 'Acme' } };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'publisher.id')).toBe(true);
  });

  it('accepts a third-party publisher when the flag is on', () => {
    const m = { ...validManifest(), publisher: { id: 'acme', name: 'Acme' } };
    expect(validateManifest(m, { allowThirdPartyPublishers: true }).ok).toBe(true);
  });

  it('rejects an unknown category and a non-semver version', () => {
    expect(validateManifest({ ...validManifest(), categories: ['finance'] }).ok).toBe(false);
    expect(validateManifest({ ...validManifest(), version: '1.0' }).ok).toBe(false);
  });

  it('rejects unknown top-level keys (strict envelope)', () => {
    expect(validateManifest({ ...validManifest(), surprise: true }).ok).toBe(false);
  });

  it('rejects the wrong manifestVersion', () => {
    expect(validateManifest({ ...validManifest(), manifestVersion: 2 }).ok).toBe(false);
  });
});

describe('validateManifest — requiredSchema', () => {
  it('rejects an enum column with no values and an fk with no target', () => {
    const base = validManifest();
    const enumless = structuredClone(base);
    (enumless.requiredSchema as any).tables[0].columns[3] = { ref: 'status', type: 'enum' };
    expect(validateManifest(enumless).ok).toBe(false);

    const fkless = structuredClone(base);
    (fkless.requiredSchema as any).tables[0].columns[4] = { ref: 'category_id', type: 'fk' };
    expect(validateManifest(fkless).ok).toBe(false);
  });

  it('rejects duplicate table and column refs', () => {
    const dupCol = structuredClone(validManifest());
    (dupCol.requiredSchema as any).tables[0].columns.push({ ref: 'name', type: 'text' });
    expect(validateManifest(dupCol).ok).toBe(false);
  });
});

describe('the three-sides rule (28 §4, D12)', () => {
  const withFrontends = (frontends: unknown) => ({ ...validManifest(), frontends });

  it('accepts a staff-only app', () => {
    expect(validateManifest(withFrontends([{ side: 'staff', kind: 'spa' }])).ok).toBe(true);
  });

  it('accepts a customer-only app', () => {
    expect(validateManifest(withFrontends([{ side: 'customer', kind: 'spa' }])).ok).toBe(true);
  });

  it('accepts both sides — the clinic-desk shape', () => {
    expect(
      validateManifest(
        withFrontends([
          { side: 'staff', kind: 'spa', routes: { desk: 'Desk' } },
          { side: 'customer', kind: 'spa', routes: { book: 'Book' } },
        ]),
      ).ok,
    ).toBe(true);
  });

  it('REFUSES an app with no side at all', () => {
    // This is the gate. Without it "at least one of staff/customer" is prose,
    // and a repo with neither is indistinguishable from a micro-SaaS.
    expect(validateManifest(withFrontends([])).ok).toBe(false);
  });

  it('REFUSES a missing frontends key', () => {
    const { frontends: _dropped, ...rest } = validManifest();
    expect(validateManifest(rest).ok).toBe(false);
  });

  it('refuses a frontend with no side', () => {
    expect(validateManifest(withFrontends([{ kind: 'spa' }])).ok).toBe(false);
  });

  it('refuses the same side twice', () => {
    // A key is minted against ONE side; two entries claiming it leave nothing
    // able to say which bundle the key belongs to.
    expect(
      validateManifest(
        withFrontends([
          { side: 'customer', kind: 'spa' },
          { side: 'customer', kind: 'electron' },
        ]),
      ).ok,
    ).toBe(false);
  });

  it('keeps `routes` — the only machine-readable record of the split', () => {
    // Eleven shipped manifests carry it and the old strict schema rejected all
    // of them. Deleting it during normalization would have made §4 uncheckable.
    const out = validateManifest(
      withFrontends([{ side: 'customer', kind: 'spa', routes: { book: 'Book a visit' } }]),
    );
    expect(out.ok).toBe(true);
  });

  it('still refuses the OLD singular `frontend`', () => {
    const { frontends: _dropped, ...rest } = validManifest();
    expect(validateManifest({ ...rest, frontend: { kind: 'spa' } }).ok).toBe(false);
  });
});

describe('validateManifest — capabilities', () => {
  it('rejects hosted-only + offline-required together', () => {
    const m = { ...validManifest(), capabilities: ['hosted-only', 'offline-required'] };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'capabilities')).toBe(true);
  });

  it('allows either alone', () => {
    expect(validateManifest({ ...validManifest(), capabilities: ['hosted-only'] }).ok).toBe(true);
    expect(validateManifest({ ...validManifest(), capabilities: ['offline-required'] }).ok).toBe(true);
  });
});

describe('validateManifest — compatibility', () => {
  it('rejects a max below the min', () => {
    const m = {
      ...validManifest(),
      compatibility: { minAdminiumVersion: '2.0.0', maxAdminiumVersion: '1.0.0' },
    };
    expect(validateManifest(m).ok).toBe(false);
  });
});

describe('validateManifest — settings', () => {
  it('rejects an enum setting with no enum values', () => {
    const m = { ...validManifest(), settings: [{ key: 'currency', type: 'enum' }] };
    expect(validateManifest(m).ok).toBe(false);
  });
});

describe('compareSemver', () => {
  it('orders release triples numerically', () => {
    expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.1-rc.1', '1.0.0')).toBeGreaterThan(0);
  });
});
