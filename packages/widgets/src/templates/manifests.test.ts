/**
 * Shipped-manifest CI gate — 04-widget-registry.md acceptance #16, second half:
 * "all shipped template manifests validate against `pageTemplateSchema` in CI".
 *
 * The gate reads the `page-*.json` files off disk rather than trusting
 * `manifests.ts` to have imported them all: a manifest that exists but was never
 * added to `MANIFEST_JSON` would otherwise pass silently while being invisible
 * to the runtime. (Node is this package's default vitest environment, so fs is
 * available — see `vitest.config.ts`.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { templateKind } from './compose.js';
import { PAGE_TEMPLATE_IDS, buildTemplateManifests, pageTemplateManifests } from './manifests.js';
import { pageTemplateSchema } from './template-schema.js';

const TEMPLATES_DIR = dirname(fileURLToPath(import.meta.url));

const manifestFiles = readdirSync(TEMPLATES_DIR)
  .filter((f) => f.startsWith('page-') && f.endsWith('.json'))
  .sort();

/** The nine M7 archetypes + the two the M4 generator already emits (deliverables 3 & 4). */
const EXPECTED_IDS = [
  'page-crud',
  'page-dashboard',
  'page-master-detail',
  'page-queue-inbox',
  'page-board',
  'page-calendar',
  'page-scheduler',
  'page-directory',
  'page-log-viewer',
  'page-files',
  'page-chat',
];

describe('shipped page-template manifests', () => {
  it('ships exactly the 11 expected archetypes', () => {
    expect([...PAGE_TEMPLATE_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(manifestFiles).toHaveLength(EXPECTED_IDS.length);
  });

  it.each(manifestFiles)('%s validates against pageTemplateSchema', (file) => {
    const raw: unknown = JSON.parse(readFileSync(join(TEMPLATES_DIR, file), 'utf8'));
    const result = pageTemplateSchema.safeParse(raw);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it.each(manifestFiles)('%s declares an id matching its filename and is loaded', (file) => {
    const raw = JSON.parse(readFileSync(join(TEMPLATES_DIR, file), 'utf8')) as { id: string };
    expect(raw.id).toBe(basename(file, '.json'));
    expect(pageTemplateManifests.has(raw.id)).toBe(true);
  });

  it('every manifest on disk is wired into manifests.ts', () => {
    const onDisk = manifestFiles.map((f) => basename(f, '.json')).sort();
    expect([...PAGE_TEMPLATE_IDS].sort()).toEqual(onDisk);
  });

  it('gives every slot a unique name within its template', () => {
    for (const manifest of pageTemplateManifests.values()) {
      const names = manifest.slots.map((s) => s.slot);
      expect(new Set(names).size, `${manifest.id} has duplicate slot names`).toBe(names.length);
    }
  });

  it('keeps every slot area inside the 12-column grid, in 40 px half-units', () => {
    for (const manifest of pageTemplateManifests.values()) {
      for (const slot of manifest.slots) {
        const where = `${manifest.id}/${slot.slot}`;
        expect(Number.isInteger(slot.area.x), where).toBe(true);
        expect(Number.isInteger(slot.area.h), `${where} height must be whole half-units`).toBe(true);
        expect(slot.area.x, where).toBeGreaterThanOrEqual(0);
        expect(slot.area.y, where).toBeGreaterThanOrEqual(0);
        expect(slot.area.w, where).toBeGreaterThanOrEqual(1);
        expect(slot.area.h, where).toBeGreaterThanOrEqual(1);
        expect(slot.area.h, `${where} exceeds the h<=24 half-unit cap`).toBeLessThanOrEqual(24);
        expect(slot.area.x + slot.area.w, `${where} overflows 12 columns`).toBeLessThanOrEqual(12);
      }
    }
  });

  it('starts every template version at 1 (no migrations shipped yet)', () => {
    for (const manifest of pageTemplateManifests.values()) expect(manifest.version).toBe(1);
  });

  it('maps only page-dashboard to the dashboard envelope kind (09 §3.2)', () => {
    const kinds = Object.fromEntries([...PAGE_TEMPLATE_IDS].map((id) => [id, templateKind(id)]));
    expect(kinds['page-dashboard']).toBe('dashboard');
    for (const id of PAGE_TEMPLATE_IDS) {
      if (id !== 'page-dashboard') expect(kinds[id], id).toBe('page');
    }
  });

  it('reproduces the §10 page-dashboard example verbatim', () => {
    const dashboard = pageTemplateManifests.get('page-dashboard');
    expect(dashboard?.titleKey).toBe('templates.dashboard.title');
    expect(dashboard?.slots.map((s) => s.slot)).toEqual([
      'kpi-row',
      'hero-chart',
      'breakdown',
      'grid-secondary',
      'recent',
      'activity',
      'insights',
    ]);
    expect(dashboard?.slots.filter((s) => s.required).map((s) => s.slot)).toEqual([
      'kpi-row',
      'hero-chart',
    ]);
    expect(dashboard?.chrome).toEqual({ toolbar: ['date-range-picker'], overlays: ['toast-stack'] });
  });
});

describe('buildTemplateManifests', () => {
  it('throws on a duplicate template id', () => {
    const one = { id: 'page-x', version: 1, titleKey: 't', slots: [] };
    expect(() => buildTemplateManifests([one, { ...one }])).toThrow(/Duplicate page-template manifest/);
  });

  it('throws on a manifest that does not parse', () => {
    expect(() => buildTemplateManifests([{ id: 'nope', version: 1, titleKey: 't', slots: [] }])).toThrow(
      /Invalid page-template manifest/,
    );
  });
});
