// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SPA's capability status logic (11-electron.md §12).
 *
 * The one contract here that MUST hold on every runtime — "non-desktop runtimes
 * report every capability `unavailable`" — is what lets a manifest page degrade
 * on self-host and Cloud instead of erroring. It is pure and lives in the SPA
 * because the dashboard is the only artifact that runs on all three runtimes, so
 * it is the only place that rule can be enforced. Pinned here without a DOM.
 */
import { describe, expect, it } from 'vitest';

import {
  capabilityStatuses,
  CAPABILITY_CATALOG,
  type CapabilityDescriptor,
} from './model.js';

const STUB_DESCRIPTORS: CapabilityDescriptor[] = [
  { id: 'printer.escpos', version: 1, status: 'stub', methods: ['listDevices', 'print', 'openDrawer'] },
];

describe('capabilityStatuses', () => {
  it('on desktop, passes the bridge descriptors through unchanged', () => {
    expect(capabilityStatuses('desktop', STUB_DESCRIPTORS)).toEqual(STUB_DESCRIPTORS);
  });

  it('on self-host, reports EVERY catalogued capability unavailable (§12)', () => {
    const result = capabilityStatuses('selfhost', null);
    expect(result.map((d) => d.id)).toEqual(CAPABILITY_CATALOG.map((c) => c.id));
    expect(result.every((d) => d.status === 'unavailable')).toBe(true);
  });

  it('on Cloud, reports every capability unavailable — even if handed descriptors', () => {
    // A stray descriptor list off-desktop must not leak an `available`/`stub`:
    // there is no bridge to have produced it, so it cannot be trusted.
    const result = capabilityStatuses('cloud', STUB_DESCRIPTORS);
    expect(result.every((d) => d.status === 'unavailable')).toBe(true);
  });

  it('on desktop before the bridge answers (null), degrades to unavailable', () => {
    const result = capabilityStatuses('desktop', null);
    expect(result.every((d) => d.status === 'unavailable')).toBe(true);
  });
});

describe('CAPABILITY_CATALOG', () => {
  it('is the closed v1 vocabulary — matches the server + host id set', () => {
    // Lockstep with `apps/server`'s `KNOWN_CAPABILITY_IDS` and the main process's
    // registered providers. A rename here without renaming there would offer
    // consent for a capability nothing can honour.
    expect(CAPABILITY_CATALOG.map((c) => c.id)).toEqual(['printer.escpos']);
  });
});
