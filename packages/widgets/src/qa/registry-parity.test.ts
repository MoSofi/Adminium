/**
 * Registry-parity gate — 04-widget-registry.md acceptance #1 / 04-T17 (1).
 *
 * Diffs the delivered widget registry against the checked-in annex-catalog
 * extraction and FAILS ON DRIFT. Four invariants, now scoped to ALL 13 families
 * (M7 Wave 3 landed calendar/boards/media/communication/domain/system/chrome/
 * forms, so the old "Wave 2/3 is known-pending, not failing" carve-out is gone):
 *
 *   1. No drift        — every registered id is a real annex id.
 *   2. Exactly once    — no id is registered twice.
 *   3. Coverage        — the registered ids of each family equal the checked-in
 *                        `EXPECTED_IDS` (annex minus the documented
 *                        `ANNEX_PENDING`) exactly.
 *   4. Live assembly   — the live `widgetRegistry` contains every delivered id,
 *                        i.e. the GREEN LOOP has spread every family into it.
 *
 * The assertions run against BOTH the harness-assembled view (`qaRegistry` /
 * `deliveredDefinitions`, built from the per-track definition arrays) and the
 * live `widgetRegistry`. Those two are now identical by invariant #4 — the
 * ratchet that used to skip until the green loop caught up is a hard gate.
 */
import { describe, expect, it } from 'vitest';

import { ALL_ANNEX_IDS, ANNEX_CATALOG, ANNEX_PENDING, EXPECTED_IDS } from './annex-catalog.js';
import { deliveredDefinitions, deliveredIdsFor, qaRegistry } from './delivered.js';
import { widgetRegistry } from '../registry/index.js';
import { WIDGET_MISSING_ID } from '../registry/widget-missing.js';
import { WIDGET_FAMILIES } from '../registry/types.js';

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** Registered ids to check for parity — infra fallback is not an annex widget. */
const registeredIds = deliveredDefinitions.map((d) => d.id);

describe('registry parity — no drift (acceptance #1)', () => {
  it('every delivered widget id exists verbatim in the annex catalog', () => {
    const unknown = registeredIds.filter((id) => !ALL_ANNEX_IDS.has(id));
    expect(unknown).toEqual([]);
  });

  it('the live widgetRegistry never registers an id outside the annex (bar the widget-missing fallback)', () => {
    const unknown = [...widgetRegistry.keys()].filter(
      (id) => id !== WIDGET_MISSING_ID && !ALL_ANNEX_IDS.has(id),
    );
    expect(unknown).toEqual([]);
  });

  it('every checked-in pending id is a real annex id of its family (guards typos in the list)', () => {
    for (const family of WIDGET_FAMILIES) {
      const annex = new Set(ANNEX_CATALOG[family]);
      expect(ANNEX_PENDING[family].filter((id) => !annex.has(id))).toEqual([]);
    }
  });
});

describe('registry parity — exactly once (acceptance #1)', () => {
  it('registers each delivered id exactly once', () => {
    const counts = new Map<string, number>();
    for (const id of registeredIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it('assembles into a valid registry (qaRegistry built without a DuplicateWidgetIdError)', () => {
    // qaRegistry is built at import time via buildRegistry, which throws on a
    // duplicate id — reaching here proves the assembled map is well-formed.
    expect(qaRegistry.size).toBe(registeredIds.length + 1); // + widget-missing
  });
});

describe('registry parity — per-family coverage snapshot (acceptance #1)', () => {
  for (const family of WIDGET_FAMILIES) {
    it(`${family}: registered ids equal the checked-in annex extraction (annex − pending)`, () => {
      // The "snapshot diff": delivered vs checked-in expected, both derived from
      // checked-in data. Adding/removing a widget without updating annex-catalog
      // fails here.
      expect(sorted(deliveredIdsFor(family))).toEqual(sorted(EXPECTED_IDS[family]));
    });

    it(`${family}: undelivered annex ids equal the documented ANNEX_PENDING set`, () => {
      const delivered = new Set(deliveredIdsFor(family));
      const missing = ANNEX_CATALOG[family].filter((id) => !delivered.has(id));
      // Forces ANNEX_PENDING to shrink to [] as the family completes: a pending
      // id that lands (but isn't removed here) makes `missing` shorter → fails.
      expect(sorted(missing)).toEqual(sorted(ANNEX_PENDING[family]));
    });
  }
});

describe('registry parity — live green-loop wiring (acceptance #1)', () => {
  it('widgetRegistry contains every delivered id (the green loop wired every family)', () => {
    const unwired = registeredIds.filter((id) => !widgetRegistry.has(id));
    expect(unwired).toEqual([]);
  });

  it('the live widgetRegistry and the harness-assembled qaRegistry are identical', () => {
    expect(sorted([...widgetRegistry.keys()])).toEqual(sorted([...qaRegistry.keys()]));
  });

  it('every family resolves through the live registry exactly as the catalog expects', () => {
    for (const family of WIDGET_FAMILIES) {
      // `widget-missing` is declared in the `system` family but is the infra
      // fallback, not an annex widget — excluded here as in the drift checks.
      const live = sorted(
        [...widgetRegistry.values()]
          .filter((d) => d.family === family && d.id !== WIDGET_MISSING_ID)
          .map((d) => d.id),
      );
      expect(live).toEqual(sorted(EXPECTED_IDS[family]));
    }
  });
});
