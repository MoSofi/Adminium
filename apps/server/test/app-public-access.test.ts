// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The endpoints an app's `publicAccess` becomes, before any table exists:
 * each named after its real table, a claim kept apart from a public read of
 * the same table, and availability as a ref of its own.
 */
import { describe, expect, it } from 'vitest';
import type { Manifest } from '@adminium/manifest';

import { planPublicEndpoints } from '../src/apps/manifest-public.js';

const manifest = {
  kind: 'app',
  key: 'pos',
  requiredSchema: { tables: [{ ref: 'bookings', columns: [{ ref: 'id' }, { ref: 'code' }, { ref: 'mobile' }] }] },
  publicAccess: [
    { table: 'bookings', methods: ['POST'], writable: ['mobile'] },
    { table: 'bookings', methods: ['GET'], claim: { match: ['code', 'mobile'] } },
    { table: 'bookings', methods: ['GET'], claim: { match: ['code'] } },
    { table: 'bookings', kind: 'availability', methods: ['GET'] },
  ],
} as unknown as Manifest;

describe('an app’s public access, planned', () => {
  it('names each endpoint after the real table, keeps claims apart, and gives availability its own ref', () => {
    const planned = planPublicEndpoints(manifest, { bookings: 'pos_bookings' }, null);
    expect(planned.map((p) => [p.ref, p.claim, p.kind])).toEqual([
      ['pos_bookings', null, 'records'],
      ['pos_bookings_claimed', ['code', 'mobile'], 'records'],
      ['pos_bookings_claimed_2', ['code'], 'records'],
      ['pos_bookings_availability', null, 'availability'],
    ]);
    // Nothing is checked before the tables exist.
    expect(planned.every((p) => p.issues.length === 0 && p.definition === null)).toBe(true);
  });

  it('asks nothing of an add-on', () => {
    expect(planPublicEndpoints({ ...manifest, kind: 'add-on' } as unknown as Manifest, {}, null)).toEqual([]);
  });
});
