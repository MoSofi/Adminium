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
    // Declared pending in PENDING_TEMPLATE_WIDGET_IDS — a manifest names them
    // ahead of their family, and generation must keep them out of stored pages.
    expect(isRegisteredWidgetId('toast-stack')).toBe(false);
    expect(isRegisteredWidgetId('date-range-picker')).toBe(false);
    expect(isRegisteredWidgetId('no-such-widget')).toBe(false);
  });
});
