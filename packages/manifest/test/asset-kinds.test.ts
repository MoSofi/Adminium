// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shop's product assets in the manifest: a file column may take a cleaned
 * SVG, a 3D model or a web font (from the release that reads them whole), and
 * a public entry's `assets` serves such columns to every visitor's browser,
 * on the terms pictures are served on.
 */
import { describe, expect, it } from 'vitest';

import { ASSET_FILE_KINDS, FILE_COLUMN_KINDS, installFloorWords, PUBLIC_ASSET_MAX_BYTES, takesAssetsOnly, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });
type Doc = Record<string, unknown>;

/** A shop with products whose columns hold a preview model, a print model, a font and SVG pieces, served as assets. */
function shop(entry: Doc = {}, floor = '0.3.43'): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'nooks',
    name: 'Nooks',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.nooks.desc', fallback: 'Nooks.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: floor, engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'shop', label: en('Shop'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'products',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'published', type: 'bool', default: false },
            { ref: 'preview', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['glb'], maxBytes: 20 * 1024 * 1024 } } },
            { ref: 'print', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['stl', '3mf'], maxBytes: 20 * 1024 * 1024 } } },
            { ref: 'font', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['woff2'], maxBytes: 2 * 1024 * 1024 } } },
            { ref: 'pieces', type: 'json', nullable: true, rules: { file: { accept: ['svg'], maxBytes: 2 * 1024 * 1024, maxCount: 12 } } },
            { ref: 'manual', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['pdf'], maxBytes: 1024 * 1024 } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-products', template: 'page-crud', title: { key: 't.products', fallback: 'Products' }, nav: { group: 'shop', icon: 'list', order: 1 }, bindings: { rows: 'products' } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/' } },
    ],
    publicAccess: [
      {
        table: 'products',
        methods: ['GET'],
        select: ['id', 'name', 'preview', 'print', 'font', 'pieces', 'manual'],
        filters: [{ column: 'published', op: 'eq', value: true }],
        assets: ['preview', 'print', 'font', 'pieces'],
        ...entry,
      },
    ],
  };
}

const issuesOf = (doc: Doc): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};

describe('the asset kinds of a file column', () => {
  it('are svg, glb, stl, 3mf and woff2, each with its size for visitors', () => {
    expect(ASSET_FILE_KINDS).toEqual(['svg', 'glb', 'stl', '3mf', 'woff2']);
    for (const kind of ASSET_FILE_KINDS) expect(FILE_COLUMN_KINDS).toContain(kind);
    expect(PUBLIC_ASSET_MAX_BYTES).toEqual({ glb: 31_457_280, stl: 31_457_280, '3mf': 31_457_280, woff2: 2_097_152, svg: 2_097_152 });
    expect(takesAssetsOnly(['glb', 'svg'])).toBe(true);
    expect(takesAssetsOnly(['glb', 'pdf'])).toBe(false);
    expect(takesAssetsOnly([])).toBe(false);
  });

  it('ask for the release that reads them, and an entry serving them does too', () => {
    expect(issuesOf(shop())).toEqual([]);
    const words = installFloorWords(shop()).filter((found) => found.word === 'file.assetKinds' || found.word === 'publicAccess.assets');
    expect(words.map((found) => `${found.word} ${found.path}`)).toEqual([
      'file.assetKinds requiredSchema.tables.0.columns.3.rules.file.accept',
      'file.assetKinds requiredSchema.tables.0.columns.4.rules.file.accept',
      'file.assetKinds requiredSchema.tables.0.columns.5.rules.file.accept',
      'file.assetKinds requiredSchema.tables.0.columns.6.rules.file.accept',
      'publicAccess.assets publicAccess.0.assets',
    ]);
    expect(WORD_FLOORS['file.assetKinds']).toBe('0.3.43');
    expect(WORD_FLOORS['publicAccess.assets']).toBe('0.3.43');
    const older = issuesOf(shop({}, '0.3.41')).join('\n');
    expect(older).toContain('file.assetKinds');
    expect(older).toContain('publicAccess.assets');
  });
});

describe("an entry's assets", () => {
  const cases: [string, Doc, string][] = [
    ['are file columns of asset kinds', { assets: ['manual'] }, '"products.manual" is not a column of assets: a file rule that takes only svg, glb, stl, 3mf, woff2'],
    ['are not plain text', { assets: ['name'] }, '"products.name" is not a column of assets'],
    ['are columns there are', { assets: ['model'] }, '"products" has no column "model"'],
    ['are shown by the entry', { select: ['id', 'name', 'print', 'font', 'pieces'], assets: ['preview'] }, '"preview" is not one of the columns the entry shows'],
    ['are served by an entry that only reads', { methods: ['GET', 'POST'], writable: ['name'] }, 'assets are served through an entry that only reads rows'],
    ['are never written by a browser', { methods: ['GET'], defaults: { preview: null } }, '"preview" is an asset every visitor loads, so a browser never writes it'],
    ['are for every visitor', { visibleWith: { table: 'products', via: 'id' } }, "assets are for every visitor; a signed-in person's own files are `files`"],
    ['are not for a session alone', { level: 'verified' }, 'assets are for every visitor; rows read by a signed-in session alone are no asset a page loads for anyone'],
    ['are served by the customer key', { key: 'staff' }, "assets are served through the app's customer key"],
    ['are named once', { assets: ['preview', 'preview'] }, 'an asset column is named twice'],
    ['are at most eight', { assets: Array.from({ length: 9 }, () => 'preview') }, 'Too big'],
  ];
  it.each(cases)('%s', (_, entry, said) => {
    expect(issuesOf(shop(entry)).join('\n')).toContain(said);
  });
});
