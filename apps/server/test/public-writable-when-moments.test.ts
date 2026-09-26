// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A public change allowed only inside a window read from moments — a refund
 * until seven days before the event, a change until two days before arrival
 * — as the public scope keeps it: the shape it takes (strict at every level),
 * one timed window per resource, ends that agree on whether they read a
 * linked row, and no write through the resource that could move the date
 * that opens its own window.
 */
import { describe, expect, it } from 'vitest';

import { compileScope, ScopeCompileError } from '../src/public-api/scope.js';
import { isMomentWindow, isTimeWindow } from '../src/public-api/relative-filters.js';

const columnsOf = (t: string): Set<string> | null =>
  t === 'public.orders' ? new Set(['id', 'event_id', 'status', 'arrive', 'held_until', 'created_on']) : null;

function issuesOf(writableWhen: Record<string, unknown>, extra: Record<string, unknown> = {}): string[] {
  try {
    compileScope(
      {
        version: 1,
        side: 'customer',
        timezone: 'Europe/London',
        resources: [{ ref: 'orders', table: 'public.orders', actions: ['read', 'update'], expose: ['id', 'status'], writable: ['status'], writableWhen, ...extra }],
      },
      columnsOf,
    );
    return [];
  } catch (e) {
    if (e instanceof ScopeCompileError) return e.issues.map((i) => i.code);
    throw e;
  }
}

const settings = { table: 'public.venue_settings', column: 'refund_days' };
const refund = {
  status: ['paid'],
  event_id: { before: { column: 'refund_until', or: [{ via: 'event_id', column: 'starts_at', minus: { days: settings } }] }, where: [{ column: 'refunds_on', eq: true }] },
};

describe('a window read from moments', () => {
  it('compiles keyed by a link, or by the date itself, and is told apart from a minutes window', () => {
    expect(issuesOf(refund)).toEqual([]);
    expect(issuesOf({ arrive: { before: { time: '15:00', minus: { hours: { table: 'public.venue_settings', column: 'cancel_hours' } } } } })).toEqual([]);
    expect(isMomentWindow(refund.event_id)).toBe(true);
    expect(isTimeWindow(refund.event_id)).toBe(false);
    expect(isTimeWindow({ within: 60 })).toBe(true);
    expect(isMomentWindow({ within: 60 })).toBe(false);
  });

  it('refuses a key it does not know at any level, an empty window, and two shifts in one', () => {
    expect(issuesOf({ event_id: { before: { column: 'starts_at', extra: 1 } } })).toContain('SCOPE_SHAPE_INVALID');
    expect(issuesOf({ event_id: { before: { column: 'starts_at', or: [{ column: 'x', plus: { weeks: 1 } }] } } })).toContain('SCOPE_SHAPE_INVALID');
    expect(issuesOf({ event_id: {} })).toContain('SCOPE_SHAPE_INVALID');
    expect(issuesOf({ arrive: { before: { time: '25:00' } } })).toContain('SCOPE_SHAPE_INVALID');
  });

  it('keeps one timed window per resource, counting a minutes window and a moment window alike', () => {
    expect(issuesOf({ ...refund, held_until: { within: 30 } })).toContain('SCOPE_SHAPE_INVALID');
    expect(issuesOf({ held_until: { within: 30 }, event_id: { where: [{ column: 'refunds_on', eq: true }] } })).toEqual([]);
  });

  it('refuses ends that disagree on reading a linked row, and linked conditions under a date', () => {
    expect(issuesOf({ event_id: { after: { column: 'doors_at' }, before: { minus: { hours: 1 } } } })).toContain('SCOPE_WRITABLE_WHEN_MOMENT_INVALID');
    expect(issuesOf({ arrive: { before: { time: '15:00' }, where: [{ column: 'refunds_on', eq: true }] } })).toContain('SCOPE_WRITABLE_WHEN_MOMENT_INVALID');
  });

  it('never lets the same write move the date that opens the window', () => {
    expect(issuesOf({ arrive: { before: { time: '15:00' } } }, { writable: ['status', 'arrive'] })).toContain('SCOPE_WRITABLE_WHEN_COLUMN_WRITABLE');
    expect(issuesOf({ event_id: { before: { column: 'starts_at' } } }, { defaults: { event_id: 1 } })).toContain('SCOPE_WRITABLE_WHEN_COLUMN_WRITABLE');
    const fallback = { event_id: { before: { column: 'refund_until', or: [{ column: 'created_on', time: '12:00' }] } } };
    expect(issuesOf(fallback, { writable: ['status', 'created_on'] })).toContain('SCOPE_WRITABLE_WHEN_COLUMN_WRITABLE');
    expect(issuesOf(fallback)).toEqual([]);
  });
});
