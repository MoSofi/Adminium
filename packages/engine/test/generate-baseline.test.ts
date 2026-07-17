import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyClassification,
  generatePages,
  parseDatabaseModel,
  type GenerateIntent,
  type PageEnvelope,
} from '../src/index.js';

/**
 * **The crud/dashboard output is pinned — this is the guard that says so.**
 *
 * `northwind.pages.baseline.json` holds every `page-crud` and `page-dashboard`
 * envelope `generatePages()` produces for each intent. Two pins in one:
 *
 *   - `page-crud` is the v0.1-gate output, BYTE-IDENTICAL through the
 *     `composeCrudBody` migration — the leaf reproduces the bespoke builder
 *     exactly, so config, nav order, slugs and `generatedHash` all held.
 *   - `page-dashboard` is the deliberate 2026-07-17 baseline of the
 *     `emitDomainDashboardCandidates` + `composeTemplate` migration: the layout
 *     (bespoke instance ids included) is unchanged, but the composed config
 *     gained `templateVersion: 2` / `toolbar` / `overlays`, so its
 *     `generatedHash` moved once. H5 keys regeneration-in-place off that hash —
 *     a silent change here would re-write every user's untouched pages on the
 *     next sync, so both templates stay byte-pinned against THIS fixture.
 *
 * If a change to the generator output is ever *intended*, that is a deliberate
 * act: re-record via `node test/record-baseline.mjs` (after a build) in the
 * same commit and say so.
 */

const modelPath = fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url));
const model = applyClassification(parseDatabaseModel(readFileSync(modelPath, 'utf8')));
const baselinePath = fileURLToPath(
  new URL('./fixtures/northwind.pages.baseline.json', import.meta.url),
);

interface Baseline {
  pages: PageEnvelope[];
  warnings: string[];
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, Baseline>;
const CONN = 'conn_01HZX0000000000000000000';

const INTENTS: GenerateIntent[] = ['full-admin', 'read-only-analytics', 'crud'];

describe('the pinned crud/dashboard output is unchanged', () => {
  it.each(INTENTS)('intent %s emits byte-identical page-crud/page-dashboard envelopes', (intent) => {
    const expected = baseline[intent] as Baseline;
    expect(expected.pages.length).toBeGreaterThan(0); // an empty fixture would pass vacuously
    const result = generatePages(model, { connectionId: CONN, intent });
    const legacy = result.pages.filter(
      (page) => page.template === 'page-crud' || page.template === 'page-dashboard',
    );
    // Ordering, ids, nav orders, config bodies and generatedHash — all of it.
    expect(JSON.parse(JSON.stringify(legacy))).toEqual(expected.pages);
  });

  it.each(INTENTS)('intent %s keeps every pre-existing warning', (intent) => {
    const expected = baseline[intent] as Baseline;
    const result = generatePages(model, { connectionId: CONN, intent });
    // Archetype warnings may be *added*; none of the old ones may disappear.
    for (const warning of expected.warnings) {
      expect(result.warnings).toContain(warning);
    }
  });

  it('adds pages rather than replacing them', () => {
    const result = generatePages(model, { connectionId: CONN });
    const expected = baseline['full-admin'] as Baseline;
    expect(result.pages.length).toBeGreaterThanOrEqual(expected.pages.length);
    // Northwind's own §14 triggers: employees.reports_to → page-directory,
    // orders.order_date + a title column → page-calendar.
    const added = result.pages.filter(
      (page) => page.template !== 'page-crud' && page.template !== 'page-dashboard',
    );
    expect(added.map((p) => p.template).sort()).toEqual(['page-calendar', 'page-directory']);
  });

  it('leaves every baseline page id and slug in place', () => {
    const result = generatePages(model, { connectionId: CONN });
    const expected = baseline['full-admin'] as Baseline;
    const ids = new Set(result.pages.map((p) => p.id));
    const slugs = new Set(result.pages.map((p) => p.nav.slug));
    for (const page of expected.pages) {
      expect(ids.has(page.id)).toBe(true);
      expect(slugs.has(page.nav.slug)).toBe(true);
    }
    // …and the additions collide with nothing.
    expect(new Set(result.pages.map((p) => p.id)).size).toBe(result.pages.length);
    expect(new Set(result.pages.map((p) => p.nav.slug)).size).toBe(result.pages.length);
  });
});
