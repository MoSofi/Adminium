/**
 * Registry cross-check gate: no shipped manifest may name a widget id the
 * runtime cannot resolve, and every id that is *pending* (declared in the annex
 * §14 composition but not yet built) must be declared as such.
 *
 * WHY `qaRegistry` AND NOT `widgetRegistry`: the per-family definition arrays
 * are assembled into the live `widgetRegistry` map by the GREEN LOOP, not by the
 * tracks that deliver them, so `widgetRegistry` lags the delivered set mid-wave.
 * `qa/delivered.ts` exists precisely to give the gates the assembled view early
 * (see its header) — cross-checking against it means this test tracks what the
 * registry *will* contain the moment the loop runs, instead of failing on a
 * wiring step that is not this track's to perform.
 */
import { describe, expect, it } from 'vitest';

import { qaRegistry } from '../qa/delivered.js';
import { composeTemplate } from './compose.js';
import { PENDING_TEMPLATE_WIDGET_IDS, crossCheckTemplate, crossCheckTemplates } from './crosscheck.js';
import { pageTemplateManifests } from './manifests.js';
import { parsePageTemplate } from './template-schema.js';

const isRegistered = (id: string): boolean => qaRegistry.has(id);
const manifests = [...pageTemplateManifests.values()];

describe('shipped manifests × the widget registry', () => {
  it('reference no unregistered, undeclared widget id anywhere', () => {
    expect(crossCheckTemplates(manifests, isRegistered)).toEqual([]);
  });

  it.each(manifests.map((m) => [m.id, m] as const))(
    '%s fills every required slot from registered widgets only',
    (_id, manifest) => {
      const required = crossCheckTemplate(manifest, isRegistered).filter(
        (i) => i.code === 'required-slot-unregistered',
      );
      expect(required).toEqual([]);
    },
  );

  /**
   * A slot must be big enough for every widget it allow-lists. `composeTemplate`
   * stamps the slot's `area` onto the winning candidate verbatim, so a slot
   * shorter than a widget's registered `minH` persists a layout item below the
   * widget's own enforced minimum: it renders clipped, and per 04 §6.1 ("a widget
   * can never be resized below minW × minH") the first drag in edit mode snaps it
   * and reflows the page.
   *
   * Caught two live manifests: `page-master-detail`'s `detail-activity` was h:6
   * against `timeline-vertical`'s minH:8 (masked by the alphabetical tiebreak,
   * which prefers the shorter `activity-feed` whenever both are emitted), and
   * `page-crud`'s was 4×4 — shorter than BOTH widgets it accepts.
   */
  it('sizes every slot to fit the minW × minH of every widget it accepts', () => {
    const offenders: string[] = [];
    for (const manifest of manifests) {
      for (const slot of manifest.slots) {
        for (const widgetId of slot.accepts.widgets ?? []) {
          const sizing = qaRegistry.get(widgetId)?.sizing;
          if (sizing === undefined) continue; // unregistered/pending — crosscheck's job
          if (slot.area.w < sizing.minW || slot.area.h < sizing.minH) {
            offenders.push(
              `${manifest.id}.${slot.slot} is ${slot.area.w}×${slot.area.h} but '${widgetId}' needs ${sizing.minW}×${sizing.minH}`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares every pending id against a real annex family, and none that already exist', () => {
    const families = new Set([
      'kpi',
      'charts',
      'tables',
      'feeds',
      'calendar',
      'boards',
      'geo',
      'media',
      'communication',
      'forms',
      'chrome',
      'system',
      'domain',
    ]);
    for (const [id, family] of Object.entries(PENDING_TEMPLATE_WIDGET_IDS)) {
      expect(families.has(family), `${id} declares unknown family '${family}'`).toBe(true);
      expect(isRegistered(id), `${id} is registered — remove it from PENDING_TEMPLATE_WIDGET_IDS`).toBe(
        false,
      );
    }
  });

  it('declares no pending id that no manifest actually references (no dead entries)', () => {
    const referenced = new Set(
      manifests.flatMap((m) => [
        ...m.slots.flatMap((s) => s.accepts.widgets ?? []),
        ...(m.chrome?.toolbar ?? []),
        ...(m.chrome?.overlays ?? []),
      ]),
    );
    for (const id of Object.keys(PENDING_TEMPLATE_WIDGET_IDS)) {
      expect(referenced.has(id), `${id} is declared pending but no manifest references it`).toBe(true);
    }
  });

  it('composes every manifest against the real registry without an unregistered id reaching the page', () => {
    for (const manifest of manifests) {
      const { page } = composeTemplate(manifest, [], { isRegistered });
      for (const id of [...(page?.toolbar ?? []), ...(page?.overlays ?? [])]) {
        expect(isRegistered(id), `${manifest.id} emitted unregistered chrome id '${id}'`).toBe(true);
      }
    }
  });
});

describe('crossCheckTemplate — failure modes', () => {
  /**
   * A genuinely still-pending annex id, used as the fixture for the pending-id
   * gradings below. It must NOT be registered — pick it from the live
   * PENDING_TEMPLATE_WIDGET_IDS rather than hard-coding, so this suite keeps
   * testing the grading logic instead of rotting the day the id it names ships
   * (which is exactly what happened to `modal-wizard` when Track FCS landed).
   */
  const pendingExample = Object.keys(PENDING_TEMPLATE_WIDGET_IDS).find((id) => !isRegistered(id));

  it('has a still-pending id available to exercise the pending gradings', () => {
    expect(pendingExample, 'no pending ids left — inline a fixture pending map below').toBeDefined();
  });

  const withWidget = (widget: string, required: boolean, fallback = 'omit'): ReturnType<typeof parsePageTemplate> =>
    parsePageTemplate({
      id: 'page-probe',
      version: 1,
      titleKey: 't',
      slots: [
        { slot: 'body', accepts: { widgets: [widget] }, area: { x: 0, y: 0, w: 12, h: 6 }, required, fallback },
      ],
    });

  it('fails a manifest referencing an unregistered id', () => {
    const issues = crossCheckTemplate(withWidget('x-not-a-widget', false), isRegistered);
    expect(issues.map((i) => i.code)).toEqual(['unregistered-widget']);
    expect(issues[0]?.widgetId).toBe('x-not-a-widget');
  });

  it('fails harder when the unregistered id sits in a required slot', () => {
    const issues = crossCheckTemplate(withWidget('x-not-a-widget', true), isRegistered);
    expect(issues.map((i) => i.code)).toEqual(['required-slot-unregistered']);
    expect(issues[0]?.message).toContain('can never be filled');
  });

  /**
   * Grading is per SLOT, not per id. A required slot that still has a registered
   * widget (or an `accepts.shapes` entry) is perfectly fillable, so one pending
   * id among its accepts is inert — reporting it fatal would hard-fail CI the
   * moment a maintainer records an annex §14 composition ahead of its family,
   * which is the exact workflow PENDING_TEMPLATE_WIDGET_IDS exists to support.
   */
  it('does not fail a required slot whose OTHER accepts are registered', () => {
    const manifest = parsePageTemplate({
      id: 'page-probe',
      version: 1,
      titleKey: 't',
      slots: [
        {
          slot: 'detail',
          accepts: { shapes: ['record'], widgets: ['detail-key-value', pendingExample as string] },
          area: { x: 0, y: 0, w: 12, h: 6 },
          required: true,
        },
      ],
    });
    expect(crossCheckTemplate(manifest, isRegistered)).toEqual([]);
  });

  it('does not fail a required widgets-only slot that has a registered sibling', () => {
    const manifest = parsePageTemplate({
      id: 'page-probe',
      version: 1,
      titleKey: 't',
      slots: [
        {
          slot: 'directory',
          accepts: { widgets: ['card-gallery', pendingExample as string] },
          area: { x: 0, y: 0, w: 12, h: 6 },
          required: true,
        },
      ],
    });
    expect(crossCheckTemplate(manifest, isRegistered)).toEqual([]);
  });

  it('still fails a required slot when EVERY accept is unregistered and no shape fills it', () => {
    const manifest = parsePageTemplate({
      id: 'page-probe',
      version: 1,
      titleKey: 't',
      slots: [
        {
          slot: 'body',
          accepts: { widgets: [pendingExample as string, 'x-also-not-a-widget'] },
          area: { x: 0, y: 0, w: 12, h: 6 },
          required: true,
        },
      ],
    });
    expect(crossCheckTemplate(manifest, isRegistered).map((i) => i.code)).toEqual([
      'required-slot-unregistered',
    ]);
  });

  it('fails an unregistered id in chrome just like one in a slot', () => {
    const issues = crossCheckTemplate(
      parsePageTemplate({
        id: 'page-probe',
        version: 1,
        titleKey: 't',
        slots: [],
        chrome: { toolbar: ['x-not-a-widget'] },
      }),
      isRegistered,
    );
    expect(issues.map((i) => i.code)).toEqual(['unregistered-widget']);
    expect(issues[0]?.slot).toBe('chrome.toolbar');
  });

  it('passes an unregistered id that is declared pending, in a degradable position', () => {
    expect(crossCheckTemplate(withWidget(pendingExample!, false), isRegistered)).toEqual([]);
  });

  it('still fails a declared-pending id in a required slot', () => {
    expect(crossCheckTemplate(withWidget(pendingExample!, true), isRegistered).map((i) => i.code)).toEqual([
      'required-slot-unregistered',
    ]);
  });

  it('fails a pending-only slot that does not fall back to omit', () => {
    const issues = crossCheckTemplate(withWidget(pendingExample!, false, 'empty-state'), isRegistered);
    expect(issues.map((i) => i.code)).toEqual(['pending-id-not-degradable']);
  });

  it('flags a stale pending entry once the widget registers', () => {
    const issues = crossCheckTemplate(withWidget('data-grid', false), isRegistered, {
      'data-grid': 'tables',
    });
    expect(issues.map((i) => i.code)).toEqual(['stale-pending-entry']);
  });

  it('flags a slot that accepts neither a shape nor a widget id', () => {
    const issues = crossCheckTemplate(
      parsePageTemplate({
        id: 'page-probe',
        version: 1,
        titleKey: 't',
        slots: [{ slot: 'dead', accepts: {}, area: { x: 0, y: 0, w: 12, h: 6 } }],
      }),
      isRegistered,
    );
    expect(issues.map((i) => i.code)).toEqual(['slot-accepts-nothing']);
  });
});
