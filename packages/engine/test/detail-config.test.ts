// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 30-T01: the typed `config.detail` schema is validated against REAL stored
 * configs — every `page-crud` envelope in the pinned generation baseline
 * (the byte-identical output `generate-baseline.test.ts` protects), not
 * hand-written fixtures. A schema that only accepts what a fixture imagines
 * would let generation and validation drift apart silently.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { PageEnvelope } from '../src/config-schema/index.js';
import { crudDetailConfigSchema, parseCrudDetailConfig } from '../src/config-schema/index.js';

const baselinePath = fileURLToPath(
  new URL('./fixtures/northwind.pages.baseline.json', import.meta.url),
);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<
  string,
  { pages: PageEnvelope[] }
>;

const crudPages = Object.values(baseline).flatMap(({ pages }) =>
  pages.filter((page) => page.template === 'page-crud'),
);

describe('crudDetailConfigSchema against the pinned generation baseline', () => {
  it('covers the baseline (an empty sweep would pass vacuously)', () => {
    expect(crudPages.length).toBeGreaterThanOrEqual(30);
  });

  it.each(crudPages.map((page) => [page.id, page] as const))(
    '%s: the stored detail block parses and names page-record',
    (_id, page) => {
      const detail = parseCrudDetailConfig(page.config);
      expect(detail).not.toBeNull();
      // The id every generated body has stored all along (30 §0.1/D3).
      expect(detail?.template).toBe('page-record');
      // Every generated tab is fully resolved: table + fkColumn + label.
      for (const tab of detail?.tabs ?? []) {
        expect(tab.table.length).toBeGreaterThan(0);
        expect(tab.fkColumn).toBeTypeOf('string');
        expect(tab.label).toBeTypeOf('string');
      }
    },
  );

  it('tolerates absence: a config without detail parses to null, not an error', () => {
    expect(parseCrudDetailConfig({})).toBeNull();
    expect(parseCrudDetailConfig({ detail: null })).toBeNull();
  });

  it('degrades an unreadable block to null rather than throwing (09 §3.1)', () => {
    expect(parseCrudDetailConfig({ detail: { tabs: [] } })).toBeNull(); // no template id
    expect(parseCrudDetailConfig({ detail: 'page-record' })).toBeNull();
  });

  it('accepts the minimal hand-authored form (template only)', () => {
    const parsed = crudDetailConfigSchema.parse({ template: 'page-record' });
    expect(parsed.tabs).toEqual([]);
  });

  it('tolerates a tab without fkColumn (the JSON round-trip drops undefined)', () => {
    const parsed = crudDetailConfigSchema.parse({
      template: 'page-record',
      tabs: [{ table: 'public.order_items' }],
    });
    expect(parsed.tabs[0]?.fkColumn).toBeUndefined();
  });
});
