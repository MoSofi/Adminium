// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The reserved / grantable split over the closed system-action set
 * (schema/json-payloads.ts). The four reserved keys are deferred features
 * with zero enforcement points in v1: they must stay in the closed grammar
 * (stored grants round-trip through it) while never being offered by a
 * permissions UI, which authors its list from GRANTABLE_SYSTEM_ACTION_KEYS.
 */
import { describe, expect, it } from 'vitest';

import {
  GRANTABLE_SYSTEM_ACTION_KEYS,
  RESERVED_SYSTEM_ACTION_KEYS,
  SYSTEM_ACTION_KEYS,
  systemActionKeySchema,
} from '../src/index.js';

describe('system action key reservation', () => {
  it('reserves exactly the three remaining deferred-feature keys', () => {
    // `manifests.manage` left this list on 2026-08-29 (26-T05) in the same
    // change that landed the `/api/v1/add-ons` routes enforcing it — which is
    // the rule the list's own docblock states.
    expect([...RESERVED_SYSTEM_ACTION_KEYS].sort()).toEqual(
      ['automations.manage', 'sql.run', 'webhooks.manage'].sort(),
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
    ]) {
      expect(GRANTABLE_SYSTEM_ACTION_KEYS, key).toContain(key);
    }
  });
});
