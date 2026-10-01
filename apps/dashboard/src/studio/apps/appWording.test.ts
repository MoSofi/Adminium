// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two places the app screens printed the server's own words at a person:
 * the Activity list (a raw audit key) and the install check's public access
 * card (one sentence per declared entry, so the same sentence four times).
 */
import { describe, expect, it } from 'vitest';

import type { AppInstallPlan } from './appsApi.js';
import { activityText, customerTrouble } from './AppSettingsPage.js';
import { accessLines } from './PublicAccessInstallCard.js';

type Endpoint = NonNullable<AppInstallPlan['publicAccess']>['endpoints'][number];

const endpoint = (over: Partial<Endpoint>): Endpoint =>
  ({ ref: 'x', table: 'proposals', kind: 'records', methods: ['PATCH'], claim: null, pending: false, issues: [], ...over }) as Endpoint;

describe('the app page’s activity', () => {
  it('names the add-on a step set up', () => {
    expect(activityText('app.add-on-step', 'owner@studio.test', 'Invoices')).toBe('Invoices set up by owner@studio.test');
    expect(activityText('app.add-on-step', 'owner@studio.test')).toBe('An add-on set up by owner@studio.test');
  });

  it('never prints an audit key it has no sentence for', () => {
    const line = activityText('app.something-new', 'owner@studio.test');
    expect(line).toBe('Changed by owner@studio.test');
    expect(line).not.toContain('app.');
  });
});

describe('the install check’s public access lines', () => {
  it('says each thing once, however many entries declare it', () => {
    const lines = accessLines([
      endpoint({ ref: 'clients_proposals_verified' }),
      endpoint({ ref: 'clients_proposals_verified_2' }),
      endpoint({ ref: 'clients_proposals_verified_3' }),
      endpoint({ ref: 'clients_proposals_verified_4' }),
      endpoint({ ref: 'clients_invoices_verified', table: 'invoices', methods: ['GET'] }),
    ]);
    expect(lines.map((entry) => entry.line)).toEqual(['Change proposals', 'Read invoices']);
  });

  it('keeps what arrives later apart from what is here now', () => {
    const lines = accessLines([
      endpoint({ ref: 'a', table: 'slots', kind: 'availability' }),
      endpoint({ ref: 'b', table: 'slots', kind: 'availability', pending: true }),
    ]);
    expect(lines.map((entry) => entry.pending)).toEqual([false, true]);
  });
});

describe('a customer side that is on', () => {
  it('says when its pages cannot read or save anything, and why', () => {
    // The page read "Customer screens · On" over pages that opened and could do nothing.
    expect(customerTrouble({ apiOn: false, granted: true })).toContain('the public API is switched off');
    expect(customerTrouble({ apiOn: true, granted: false })).toContain('installed without its public access');
    // Nothing to say when it can answer, or when the app asks for no public access.
    expect(customerTrouble({ apiOn: true, granted: true })).toBeNull();
    expect(customerTrouble(undefined)).toBeNull();
  });
});
