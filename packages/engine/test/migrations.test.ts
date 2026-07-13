import { describe, expect, it } from 'vitest';

import {
  CONFIG_VERSION,
  ConfigMigrationError,
  configMigrations,
  latestConfigVersion,
  runConfigMigrations,
  type ConfigMigration,
} from '../src/config-schema/index.js';

const v1Doc = {
  v: 1,
  kind: 'page',
  id: 'page_customers',
  legacyPageSize: 50,
};

describe('runConfigMigrations (current build: v1, no registered migrations)', () => {
  it('ships v1 as the current version with an empty migration list', () => {
    expect(CONFIG_VERSION).toBe(1);
    expect(configMigrations).toHaveLength(0);
    expect(latestConfigVersion()).toBe(1);
  });

  it('returns a v1 document unchanged', () => {
    const result = runConfigMigrations(v1Doc);
    expect(result).toEqual(v1Doc);
  });

  it('rejects a document newer than the latest supported version', () => {
    expect(() => runConfigMigrations({ ...v1Doc, v: 2 })).toThrow(ConfigMigrationError);
    expect(() => runConfigMigrations({ ...v1Doc, v: 2 })).toThrow(/newer than/);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'doc'],
    ['missing v', { kind: 'page' }],
    ['non-integer v', { v: 1.5 }],
    ['zero v', { v: 0 }],
    ['string v', { v: '1' }],
  ])('rejects %s', (_label, doc) => {
    expect(() => runConfigMigrations(doc)).toThrow(ConfigMigrationError);
  });
});

describe('runConfigMigrations with an injected migration chain', () => {
  const v1toV2: ConfigMigration = {
    from: 1,
    to: 2,
    migrate: (doc) => {
      const { legacyPageSize, ...rest } = doc as typeof v1Doc & { v: number };
      return { ...rest, pageSize: legacyPageSize };
    },
  };
  const v2toV3: ConfigMigration = {
    from: 2,
    to: 3,
    migrate: (doc) => ({ ...doc, upgradedTwice: true }),
  };

  it('genuinely runs a fake v1→v2 migration', () => {
    const result = runConfigMigrations(v1Doc, [v1toV2]);
    expect(result.v).toBe(2);
    expect(result['pageSize']).toBe(50);
    expect(result).not.toHaveProperty('legacyPageSize');
    expect(result['id']).toBe('page_customers');
  });

  it('walks a multi-step chain v1→v2→v3 in order', () => {
    const result = runConfigMigrations(v1Doc, [v1toV2, v2toV3]);
    expect(result.v).toBe(3);
    expect(result['pageSize']).toBe(50);
    expect(result['upgradedTwice']).toBe(true);
  });

  it('starts mid-chain for documents already at an intermediate version', () => {
    const result = runConfigMigrations({ v: 2, pageSize: 25 }, [v1toV2, v2toV3]);
    expect(result.v).toBe(3);
    expect(result['pageSize']).toBe(25);
  });

  it('leaves documents already at the latest version untouched', () => {
    const doc = { v: 3, pageSize: 25 };
    expect(runConfigMigrations(doc, [v1toV2, v2toV3])).toEqual(doc);
  });

  it('never mutates the caller document, even with a mutating migration', () => {
    const mutating: ConfigMigration = {
      from: 1,
      to: 2,
      migrate: (doc) => {
        doc['mutated'] = true; // misbehaving migration
        return doc;
      },
    };
    const original = { v: 1, nested: { keep: 'me' } };
    const result = runConfigMigrations(original, [mutating]);
    expect(result['mutated']).toBe(true);
    expect(original).toEqual({ v: 1, nested: { keep: 'me' } });
  });

  it('stamps the step target version even if a migration forgets to bump v', () => {
    const forgetful: ConfigMigration = { from: 1, to: 2, migrate: (doc) => ({ ...doc }) };
    expect(runConfigMigrations({ v: 1 }, [forgetful]).v).toBe(2);
  });

  it('throws on a gap in the chain', () => {
    expect(() => runConfigMigrations(v1Doc, [v2toV3])).toThrow(/no config migration.*version 1/);
  });

  it('rejects a document newer than the chain target', () => {
    expect(() => runConfigMigrations({ v: 4 }, [v1toV2, v2toV3])).toThrow(/newer than/);
  });

  it('rejects a malformed migration step (to <= from)', () => {
    const backwards: ConfigMigration = { from: 1, to: 1, migrate: (doc) => doc };
    // latest = max(to) = CONFIG_VERSION = 1 here, so force a walk via a valid second step
    expect(() => runConfigMigrations({ v: 1 }, [backwards, v2toV3])).toThrow(
      ConfigMigrationError,
    );
  });
});
