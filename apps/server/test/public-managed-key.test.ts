// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The safe list an installed app's own key is held to, and the edits refused
 * on an endpoint it uses.
 */
import { describe, expect, it } from 'vitest';

import type { PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { managedEditIssues, managedGrantIssues } from '../src/public-api/managed-key.js';

const base = {
  path: '/pos_reservations',
  source: 'main.pos_reservations',
  methods: ['GET'],
  select: ['id', 'starts_at'],
  filters: [],
  pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
  auth: { role: 'anon' },
  rate_limit: { requests: 60, window: '1m' },
  response: { shape: 'object', envelope: 'data' },
} as unknown as PublicEndpointDefinition;

const def = (over: Record<string, unknown>) => ({ ...base, ...over }) as PublicEndpointDefinition;
const codes = (issues: { message: string }[]) => issues.map((i) => i.message);

describe('what an app’s own key may hold', () => {
  it('holds GET and POST, never PUT, DELETE or BATCH', () => {
    expect(managedGrantIssues('r', def({ methods: ['POST'] }), ['POST'], new Set())).toEqual([]);
    expect(codes(managedGrantIssues('r', def({ methods: ['PUT', 'DELETE', 'BATCH'] }), ['PUT', 'DELETE', 'BATCH'], new Set()))).toEqual([
      'an app’s own key may not hold PUT on "r"',
      'an app’s own key may not hold DELETE on "r"',
      'an app’s own key may not hold BATCH on "r"',
    ]);
  });

  it('holds PATCH only where a guest signs in, and never on a column Adminium decides', () => {
    const claimed = def({ methods: ['GET', 'PATCH'], auth: { role: 'authenticated' }, writable: ['starts_at', 'code'] });
    expect(managedGrantIssues('r', claimed, ['GET', 'PATCH'], new Set())).toEqual([]);
    expect(codes(managedGrantIssues('r', claimed, ['GET', 'PATCH'], new Set(['code'])))).toEqual([
      '"code" is decided by Adminium, so a guest may not change it through "r"',
    ]);
    expect(codes(managedGrantIssues('r', def({ methods: ['PATCH'] }), ['PATCH'], new Set()))).toEqual([
      'an app’s own key may hold PATCH on "r" only where a guest signs in to reach their own row',
    ]);
  });

  it('never lets anyone both create and read', () => {
    expect(codes(managedGrantIssues('r', def({ methods: ['GET', 'POST'] }), ['POST'], new Set()))).toEqual([
      '"r" lets anyone create a row, so it may not also let anyone read one',
    ]);
  });
});

describe('what may not change on an endpoint an app’s own key uses', () => {
  const noGains = [] as const;
  it('refuses a new write method, a lost sign-in, and a lost claim', () => {
    const before = def({ auth: { role: 'authenticated' }, identity: { strategy: 'lookup', match: ['code'], column: 'id' } });
    expect(codes(managedEditIssues('r', before, def({ methods: ['GET', 'PATCH'] }), noGains))).toEqual([
      'an app’s own key uses "r", so it may not gain PATCH',
      'an app’s own key uses "r", so it must keep asking guests to sign in',
      'an app’s own key signs guests in through "r", so it must keep its claim',
    ]);
  });

  it('refuses more columns, more rows and more methods for the key', () => {
    expect(
      codes(managedEditIssues('r', base, base, [{ ref: 'r', columns: ['mobile'], rows: true, methods: ['POST'] }])),
    ).toEqual([
      'an app’s own key would see more of "r": mobile',
      'an app’s own key would reach more rows of "r"',
      'an app’s own key would gain POST on "r"',
    ]);
  });

  it('lets a narrowing through', () => {
    expect(managedEditIssues('r', base, def({ select: ['id'] }), noGains)).toEqual([]);
  });
});
