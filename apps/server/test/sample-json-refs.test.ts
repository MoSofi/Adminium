// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW NAMED INSIDE A JSON VALUE.
 *
 * A sample row may name an earlier row by its label (`{"@ref": "<label>"}`)
 * in a column, and anywhere inside a json value: a funnel's steps name its
 * pages and forms by key, a page's link names another page. Inside json the
 * key is written as text, whatever the engine hands back (an int, a bigint
 * Postgres reads as text, a uuid), since a json document names a row by a text
 * key. Postgres and MySQL read a json column back parsed, SQLite as text.
 */
import { SAMPLE_JSON_DEPTH } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const TABLES = [
  { ref: 'pages', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
  { ref: 'events', columns: [{ ref: 'id', type: 'bigint', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
  { ref: 'forms', columns: [{ ref: 'id', type: 'uuid', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
  {
    ref: 'funnels',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'steps', type: 'json' },
      { ref: 'page_doc', type: 'json', nullable: true },
      // A column's own `@ref` keeps the key as the engine holds it: the link column a foreign key reads.
      { ref: 'first_page_id', type: 'int', nullable: true, references: 'pages' },
    ],
  },
];

const FORM_ID = 'b398a577-930b-4293-a64d-4f9372bc4841';

/** `inner`, `levels` objects down. */
const nested = (levels: number, inner: unknown): unknown => (levels === 0 ? inner : { down: nested(levels - 1, inner) });

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest(TABLES),
  compatibility: { minAdminiumVersion: '0.3.28' },
  sampleData: { file: 'seeds/studio.sample.json' },
});

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'pages', rows: [{ '@label': 'page:open-day', name: 'Open day' }, { '@label': 'page:spring', name: 'Spring' }] },
    { ref: 'events', rows: [{ '@label': 'event:fair', name: 'Fair' }] },
    { ref: 'forms', rows: [{ '@label': 'form:showroom', id: FORM_ID, name: 'Showroom' }] },
    {
      ref: 'funnels',
      rows: [
        {
          '@label': 'funnel:open-day',
          name: 'Open day',
          first_page_id: { '@ref': 'page:open-day' },
          steps: [
            { kind: 'page', key: { '@ref': 'page:open-day' } },
            { kind: 'form', key: { '@ref': 'form:showroom' }, addOn: 'forms' },
            { kind: 'event', key: { '@ref': 'event:fair' } },
          ],
          // Five levels down: a page document's button links to another page.
          // And the deepest the loader reads: the column's value is level 0.
          page_doc: { v: 1, blocks: [{ id: 'hero', kind: 'hero', button: { label: 'Spring', link: { kind: 'page', key: { '@ref': 'page:spring' } } } }], deep: nested(SAMPLE_JSON_DEPTH - 1, { '@ref': 'page:spring' }) },
        },
      ],
    },
  ],
};

const parsed = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a row named inside a json value on ${dialect}`, () => {
    let h: InvoicingHarness;
    let add: () => Promise<unknown>;
    let remove: () => Promise<unknown>;
    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(), undefined, { 'seeds/studio.sample.json': JSON.stringify(BUNDLE) });
      const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      const app = (await findSampleApp(h.meta, 'studio'))!;
      add = () => service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
      remove = () => service.remove(app, { keepChanged: true, userId: null, userLabel: 'test' });
      await add();
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });

    it('writes each row\'s key as text inside the json, at any depth', async () => {
      const pages = await h.rows(`SELECT id, name FROM ${h.real('pages')} ORDER BY id`);
      const [event] = await h.rows(`SELECT id FROM ${h.real('events')}`);
      const openDay = String(pages.find((page) => page['name'] === 'Open day')!['id']);
      const spring = String(pages.find((page) => page['name'] === 'Spring')!['id']);
      const [funnel] = await h.rows(`SELECT steps, page_doc, first_page_id FROM ${h.real('funnels')}`);
      expect(parsed(funnel!['steps'])).toEqual([
        { kind: 'page', key: openDay },
        { kind: 'form', key: FORM_ID, addOn: 'forms' },
        { kind: 'event', key: String(event!['id']) },
      ]);
      expect(parsed(funnel!['page_doc'])).toEqual({ v: 1, blocks: [{ id: 'hero', kind: 'hero', button: { label: 'Spring', link: { kind: 'page', key: spring } } }], deep: nested(SAMPLE_JSON_DEPTH - 1, spring) });
      // In a column of its own, the key stays the number the link column holds.
      expect(String(funnel!['first_page_id'])).toBe(openDay);
      expect(typeof funnel!['first_page_id']).toBe('number');
    });

    it('takes the rows away again, the funnel before the pages it names', async () => {
      await remove();
      for (const ref of ['funnels', 'forms', 'events', 'pages']) expect(await h.rows(`SELECT id FROM ${h.real(ref)}`), ref).toEqual([]);
    });
  });
}
