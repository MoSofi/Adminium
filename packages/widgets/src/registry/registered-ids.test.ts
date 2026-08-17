// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The gate that makes `./registered-ids.ts` trustworthy.
 *
 * That list is the leaf-safe mirror of `widgetRegistry` the generator defaults
 * to for its `isRegistered` test (04 §8 H1/H4). A mirror that silently drifts is
 * worse than no mirror: a missing entry drops a registered widget out of every
 * generated page, and a stale entry persists an id that renders `widget-missing`
 * — exactly what the membership test exists to prevent. So parity is asserted in
 * BOTH directions, mirroring `../qa/registry-parity.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { widgetRegistry } from './index.js';
import { REGISTERED_WIDGET_IDS, isRegisteredWidgetId } from './registered-ids.js';

describe('REGISTERED_WIDGET_IDS mirrors the live widgetRegistry', () => {
  const live = [...widgetRegistry.keys()].sort();

  it('lists exactly the registered ids — no missing, no stale entries', () => {
    // If this fails: a widget was registered (add its id) or unregistered
    // (remove it). The diff below names the ids either way.
    expect([...REGISTERED_WIDGET_IDS]).toEqual(live);
  });

  it('is sorted and duplicate-free', () => {
    expect([...REGISTERED_WIDGET_IDS]).toEqual([...new Set(REGISTERED_WIDGET_IDS)].sort());
  });

  it('isRegisteredWidgetId answers for registered and unregistered ids', () => {
    expect(isRegisteredWidgetId('data-grid')).toBe(true);
    expect(isRegisteredWidgetId('widget-missing')).toBe(true);
    /*
      This assertion used to carry a rotating "declared-pending" example — an id
      a shipped manifest named ahead of its family, which generation had to keep
      out of stored pages. `toast-stack`, then `date-range-picker`, then
      `starter-template-picker` each held the slot and each was flipped to `true`
      as its track landed.

      THERE IS NO SUCH ID ANY MORE. TRACK OPS closed the annex at 176/176, and
      `PENDING_TEMPLATE_WIDGET_IDS` is now empty — so every id every manifest
      names is registered, and the three former examples are all asserted
      positively below. The negative case is now carried by a SYNTHETIC id, which
      is the honest form of it: the predicate's job is to reject ids that are not
      in the registry, and no real id qualifies any more.
    */
    expect(isRegisteredWidgetId('toast-stack')).toBe(true);
    expect(isRegisteredWidgetId('date-range-picker')).toBe(true);
    expect(isRegisteredWidgetId('starter-template-picker')).toBe(true);
    expect(isRegisteredWidgetId('no-such-widget')).toBe(false);
    expect(isRegisteredWidgetId('')).toBe(false);
  });
});
