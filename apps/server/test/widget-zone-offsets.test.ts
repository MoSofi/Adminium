// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The instants a venue's and a server's clocks move at, found to the minute:
 * what MySQL and SQLite buckets choose each row's minutes by.
 */
import { describe, expect, it } from 'vitest';

import { offsetSpans, stepsOf, wallText } from '../src/widget-data/zone-offsets.js';

describe('the clock changes between two instants', () => {
  it('finds both zones’ changes to the minute, oldest first, the first reaching back for ever', () => {
    // London goes back on 25 October at 01:00 UTC; Los Angeles on 1 November at 09:00 UTC.
    const spans = offsetSpans('Europe/London', 'America/Los_Angeles', new Date('2026-10-20T00:00:00Z'), new Date('2026-11-10T00:00:00Z'));
    expect(spans).toEqual([
      { at: null, venue: 60, server: -420 },
      { at: Date.parse('2026-10-25T01:00:00Z'), venue: 0, server: -420 },
      { at: Date.parse('2026-11-01T09:00:00Z'), venue: 0, server: -480 },
    ]);
    // What a zone-less value (on the server's clock) moves by, and where each step starts on that clock.
    const steps = stepsOf(spans, (span) => span.venue - span.server);
    expect(steps.map((step) => step.value)).toEqual([480, 420, 480]);
    expect(steps.slice(1).map((step) => wallText(step.at!, step.span.server))).toEqual(['2026-10-24 18:00:00', '2026-11-01 01:00:00']);
  });

  it('merges steps a change leaves where they were, and finds none in a zone that keeps one offset', () => {
    const same = offsetSpans('America/Los_Angeles', 'America/Los_Angeles', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'));
    expect(same).toHaveLength(3);
    expect(stepsOf(same, (span) => span.venue - span.server)).toHaveLength(1);
    expect(offsetSpans('Asia/Tokyo', 'UTC', new Date('2020-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toEqual([{ at: null, venue: 540, server: 0 }]);
  });

  it('reads a half-hour zone and a range over years', () => {
    // Adelaide: +10:30 in summer, +09:30 in winter; ten years hold twenty changes.
    const spans = offsetSpans('Australia/Adelaide', 'UTC', new Date('2016-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    expect(spans.length).toBe(21);
    expect(new Set(spans.map((span) => span.venue))).toEqual(new Set([630, 570]));
  });
});
