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
  it('reserves exactly the four deferred-feature keys', () => {
    expect([...RESERVED_SYSTEM_ACTION_KEYS].sort()).toEqual(
      ['automations.manage', 'manifests.manage', 'sql.run', 'webhooks.manage'].sort(),
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
    ]) {
      expect(GRANTABLE_SYSTEM_ACTION_KEYS, key).toContain(key);
    }
  });
});
