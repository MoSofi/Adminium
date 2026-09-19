// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `buildAddOnNav` — the rail rows an installed add-on contributes (51b).
 *
 * Driven with manifest DOCUMENTS rather than a database, because everything
 * that goes wrong in this function is grouping and ordering. The documents are
 * real manifests: they go through `addOnManifestSchema` on the way in, so a
 * fixture that could not be installed cannot pass here either.
 */
import { describe, expect, it } from 'vitest';

import { buildAddOnNav } from '../src/routes/bootstrap/handlers.js';

function manifest(key: string, addOn: Record<string, unknown>): { document: unknown } {
  return {
    document: {
      kind: 'add-on',
      manifestVersion: 1,
      key,
      name: key,
      version: '1.0.0',
      publisher: { id: 'adminium', name: 'Adminium' },
      license: 'AGPL-3.0-only',
      description: { key: `addon.${key}.line`, fallback: 'x' },
      categories: ['data'],
      compatibility: { minAdminiumVersion: '1.0.0' },
      addOn: {
        attaches: [{ app: '*' }],
        connect: { kind: 'none' },
        hostApi: 1,
        ...addOn,
      },
    },
  };
}

const page = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ref: 'documents',
  title: { key: 'addon.invoices.nav', fallback: 'Invoices' },
  icon: 'file-text',
  client: 'dist/pages/invoices.js',
  nav: { group: 'library', order: 20 },
  ...over,
});

describe('buildAddOnNav', () => {
  it('is empty when nothing is installed', () => {
    expect(buildAddOnNav([])).toEqual({ groups: [], pages: [] });
  });

  it('is empty when an installed add-on declares no page', () => {
    expect(buildAddOnNav([manifest('shipping-dhl', {})])).toEqual({ groups: [], pages: [] });
  });

  it('carries a page into the group it asked for, key and fallback unresolved', () => {
    const nav = buildAddOnNav([manifest('invoices', { pages: [page()] })]);
    expect(nav.pages).toEqual([
      {
        addOnKey: 'invoices',
        ref: 'documents',
        labelKey: 'addon.invoices.nav',
        fallback: 'Invoices',
        icon: 'file-text',
        client: 'dist/pages/invoices.js',
        group: 'library',
        order: 20,
        adminOnly: false,
        detail: false,
      },
    ]);
  });

  it('lands a page with no group in Library — the ruling, end to end', () => {
    const nav = buildAddOnNav([
      manifest('invoices', { pages: [page({ nav: { order: 20 } })] }),
    ]);
    expect(nav.pages[0]?.group).toBe('library');
  });

  it('leaves out a page that asked for no rail row', () => {
    const nav = buildAddOnNav([manifest('invoices', { pages: [page({ nav: undefined })] })]);
    expect(nav.pages).toEqual([]);
  });

  it('sorts by order, then by add-on key, so two add-ons do not swap between boots', () => {
    const nav = buildAddOnNav([
      manifest('zeta', { pages: [page({ ref: 'z', nav: { group: 'library', order: 10 } })] }),
      manifest('alpha', { pages: [page({ ref: 'a', nav: { group: 'library', order: 10 } })] }),
      manifest('mid', { pages: [page({ ref: 'm', nav: { group: 'library', order: 5 } })] }),
    ]);
    expect(nav.pages.map((p) => p.addOnKey)).toEqual(['mid', 'alpha', 'zeta']);
  });

  it('carries a declared group, with the label the add-on brought', () => {
    const nav = buildAddOnNav([
      manifest('invoices', {
        pages: [page({ nav: { group: 'documents', order: 1 } })],
        navGroups: [
          { key: 'documents', label: { key: 'addon.invoices.group', fallback: 'Documents' }, order: 10 },
        ],
      }),
    ]);
    expect(nav.groups).toEqual([
      {
        key: 'documents',
        labelKey: 'addon.invoices.group',
        fallback: 'Documents',
        order: 10,
        addOnKey: 'invoices',
      },
    ]);
  });

  it('lets two add-ons share one group, first declarer owning the label', () => {
    // Two add-ons wanting a Documents group is the feature working, not a
    // collision — and `enabledForHost` returns them ordered by key, so "first"
    // is stable rather than whatever the database felt like.
    const group = (fallback: string) => ({
      key: 'documents',
      label: { key: 'addon.x.group', fallback },
      order: 10,
    });
    const nav = buildAddOnNav([
      manifest('alpha', {
        pages: [page({ ref: 'a', nav: { group: 'documents', order: 1 } })],
        navGroups: [group('Documents')],
      }),
      manifest('beta', {
        pages: [page({ ref: 'b', nav: { group: 'documents', order: 2 } })],
        navGroups: [group('Paperwork')],
      }),
    ]);
    expect(nav.groups).toHaveLength(1);
    expect(nav.groups[0]?.fallback).toBe('Documents');
    expect(nav.pages).toHaveLength(2);
  });

  it('cannot be handed an orphaned group, because the schema refuses that manifest', () => {
    // A group declared with no page of its own does not validate, so the whole
    // manifest is skipped rather than contributing a heading with nothing under
    // it. This is why `buildAddOnNav` has no empty-group filter: it could never
    // run. The reachable empty heading is the rail's (all rows `adminOnly`),
    // and `sidebarNav.addOns.test.tsx` is where that is held.
    const nav = buildAddOnNav([
      manifest('groups-only', {
        pages: [page({ ref: 'x', nav: { group: 'library', order: 1 } })],
        navGroups: [{ key: 'documents', label: { key: 'g', fallback: 'Documents' }, order: 1 }],
      }),
    ]);
    expect(nav.groups).toEqual([]);
    expect(nav.pages).toEqual([]);
  });

  it('ignores a document that does not parse instead of taking the rail down with it', () => {
    const nav = buildAddOnNav([
      { document: { kind: 'add-on', manifestVersion: 1, key: 'broken' } },
      manifest('invoices', { pages: [page()] }),
    ]);
    expect(nav.pages.map((p) => p.addOnKey)).toEqual(['invoices']);
  });

  it('carries adminOnly and detail through as declared', () => {
    const nav = buildAddOnNav([
      manifest('invoices', {
        pages: [page({ detail: true, nav: { group: 'library', order: 1, adminOnly: true } })],
      }),
    ]);
    expect(nav.pages[0]?.adminOnly).toBe(true);
    expect(nav.pages[0]?.detail).toBe(true);
  });
});
