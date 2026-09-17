// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The reserved / grantable split over the closed system-action set
 * (schema/json-payloads.ts). The four reserved keys are deferred features
 * with zero enforcement points in v1: they must stay in the closed grammar
 * (stored grants round-trip through it) while never being offered by a
 * permissions UI, which authors its list from GRANTABLE_SYSTEM_ACTION_KEYS.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GRANTABLE_SYSTEM_ACTION_KEYS,
  RESERVED_SYSTEM_ACTION_KEYS,
  SYSTEM_ACTION_KEYS,
  systemActionKeySchema,
} from '../src/index.js';

describe('system action key reservation', () => {
  it('reserves exactly the three remaining deferred-feature keys', () => {
    // `manifests.manage` left this list on 2026-08-29 in the same
    // change that landed the `/api/v1/add-ons` routes enforcing it — which is
    // the rule the list's own docblock states.
    expect([...RESERVED_SYSTEM_ACTION_KEYS].sort()).toEqual(
      ['sql.run', 'webhooks.manage'].sort(),
    );
  });

  it('keeps every reserved key inside the closed grammar (stored-grant round-trips)', () => {
    for (const key of RESERVED_SYSTEM_ACTION_KEYS) {
      expect(SYSTEM_ACTION_KEYS, key).toContain(key);
      // The enum schema still accepts them — a persisted grant row for a
      // reserved key must keep validating on read.
      expect(systemActionKeySchema.parse(key), key).toBe(key);
    }
  });

  it('grantable = closed set minus reserved, disjoint and drift-proof', () => {
    for (const key of RESERVED_SYSTEM_ACTION_KEYS) {
      expect(GRANTABLE_SYSTEM_ACTION_KEYS, key).not.toContain(key);
    }
    // Union reconstructs the closed set exactly — neither list can drift.
    expect([...GRANTABLE_SYSTEM_ACTION_KEYS, ...RESERVED_SYSTEM_ACTION_KEYS].sort()).toEqual(
      [...SYSTEM_ACTION_KEYS].sort(),
    );
  });

  it('still offers every key a v1 route actually enforces', () => {
    for (const key of [
      'users.manage',
      'roles.manage',
      'settings.manage',
      'connections.manage',
      'schema.remap',
      'llm.run',
      'api-keys.manage',
      'audit.read',
      'exports.manage',
      'imports.manage',
      'reports.manage',
      'jobs.read',
      'jobs.manage',
      'manifests.manage',
      'schema.ddl',
    ]) {
      expect(GRANTABLE_SYSTEM_ACTION_KEYS, key).toContain(key);
    }
  });
});

/**
 * The dashboard's `RESERVED_GRANTS` mirror, checked.
 *
 * `apps/dashboard/src/team/rolesApi.ts` keeps a hand-copied mirror of
 * {@link RESERVED_SYSTEM_ACTION_KEYS} and its own header says nothing detects
 * drift: the dashboard cannot import `@adminium/meta` (the dep-cruiser rule
 * `dashboard-no-meta-adapters-llm` forbids it), so a key left in the mirror
 * after being un-reserved server-side is silently dropped by
 * `catalogPermissions()` and never appears in the permissions matrix — no
 * error, no failing test, just a grant an operator cannot give.
 *
 * That already happened once: `manifests.manage` was un-reserved on 2026-08-29
 * and the mirror had to be edited by hand in the same change, with nothing to
 * catch it if it had not been.
 *
 * This test READS the file rather than importing it. A path is not an import,
 * so the dep-cruiser boundary is untouched, and the check runs on the side of
 * the boundary that owns the truth.
 */
describe("the dashboard's RESERVED_GRANTS mirror", () => {
  const MIRROR_PATH = fileURLToPath(
    new URL('../../../apps/dashboard/src/team/rolesApi.ts', import.meta.url),
  );

  /** `sql.run` → `system:sql:run`, the grant-string form the dashboard uses. */
  const asGrant = (key: string): string => `system:${key.replace('.', ':')}`;

  function readMirror(): string[] {
    const source = readFileSync(MIRROR_PATH, 'utf8');
    const block = /export const RESERVED_GRANTS: readonly string\[\] = \[(.*?)\];/s.exec(source);
    expect(block, 'RESERVED_GRANTS was not found in rolesApi.ts').not.toBeNull();
    return [...block![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  }

  it('matches RESERVED_SYSTEM_ACTION_KEYS exactly', () => {
    expect(readMirror().sort()).toEqual([...RESERVED_SYSTEM_ACTION_KEYS].map(asGrant).sort());
  });

  it('does not list a key that is grantable — that key would vanish from the UI', () => {
    const mirror = new Set(readMirror());
    for (const key of GRANTABLE_SYSTEM_ACTION_KEYS) {
      expect(mirror.has(asGrant(key)), `${key} is grantable but reserved in the dashboard`).toBe(
        false,
      );
    }
  });
});
