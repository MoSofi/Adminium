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
    // `toast-stack` and `date-range-picker` stood here as the declared-pending
    // cases until M7 Wave 4 delivered them. They now register, so asserting they
    // do NOT would assert the opposite of the truth. `starter-template-picker`
    // replaces them as the live example of the case: it is the last id still in
    // PENDING_TEMPLATE_WIDGET_IDS — `page-builder`'s `chrome.overlays` names it
    // ahead of TRACK OPS delivering it, and generation must keep it out of
    // stored pages until then. Now that they ship, both former pending ids are
    // asserted positively, so this stays a two-sided test.
    expect(isRegisteredWidgetId('toast-stack')).toBe(true);
    expect(isRegisteredWidgetId('date-range-picker')).toBe(true);
    expect(isRegisteredWidgetId('starter-template-picker')).toBe(false);
    expect(isRegisteredWidgetId('no-such-widget')).toBe(false);
  });
});
