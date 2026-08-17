// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-engine capability matrix + degradation notes (M9-T04,
 * gap-analysis §2.1): the static facts that drive the wizard's honesty copy.
 */
import { describe, expect, it } from 'vitest';

import {
  adapterCapabilitiesSchema,
  capabilitiesForSource,
  capabilityNotesForSource,
  ENGINE_CAPABILITY_MATRIX,
  IMPORT_BASE_CAPABILITIES,
  rowEstimateQualityForSource,
  SOURCE_ENGINES,
} from '../src/index.js';

describe('ENGINE_CAPABILITY_MATRIX', () => {
  it('has a valid AdapterCapabilities column per live engine', () => {
    expect(SOURCE_ENGINES).toEqual(['postgres', 'mysql', 'sqlite']);
    for (const engine of SOURCE_ENGINES) {
      expect(adapterCapabilitiesSchema.parse(ENGINE_CAPABILITY_MATRIX[engine])).toEqual(
        ENGINE_CAPABILITY_MATRIX[engine],
      );
    }
    expect(adapterCapabilitiesSchema.parse(IMPORT_BASE_CAPABILITIES)).toEqual(IMPORT_BASE_CAPABILITIES);
  });

  it('encodes the 05 §4 dialect facts', () => {
    expect(ENGINE_CAPABILITY_MATRIX.postgres).toMatchObject({
      hasSchemas: true,
      hasRLS: true,
      hasMaterializedViews: true,
      maxIdentifierLength: 63,
    });
    expect(ENGINE_CAPABILITY_MATRIX.mysql).toMatchObject({
      hasSchemas: false,
      supportsReturning: false,
      maxIdentifierLength: 64,
    });
    expect(ENGINE_CAPABILITY_MATRIX.sqlite).toMatchObject({
      hasEnums: false, // CHECK synthesis only
      hasComments: false,
      supportsStatementTimeout: false,
      maxIdentifierLength: 128,
    });
    // No import ever has live signals (05 §5.2).
    expect(IMPORT_BASE_CAPABILITIES).toMatchObject({ hasRowEstimates: false, hasRLS: false });
  });

  it('capabilitiesForSource picks the engine column or the import baseline', () => {
    expect(capabilitiesForSource({ kind: 'live', engine: 'mysql' })).toBe(ENGINE_CAPABILITY_MATRIX.mysql);
    expect(capabilitiesForSource({ kind: 'import' })).toBe(IMPORT_BASE_CAPABILITIES);
  });
});

describe('capabilityNotesForSource', () => {
  it('postgres needs no caveats', () => {
    expect(capabilityNotesForSource({ kind: 'live', engine: 'postgres' })).toEqual([]);
  });

  it('mysql: approximate estimates + weaker FK/enum metadata', () => {
    expect(capabilityNotesForSource({ kind: 'live', engine: 'mysql' })).toEqual([
      'mysql-approximate-row-estimates',
      'mysql-weaker-fk-enum-metadata',
    ]);
  });

  it('sqlite: CHECK-enum synthesis + no comments', () => {
    expect(capabilityNotesForSource({ kind: 'live', engine: 'sqlite' })).toEqual([
      'sqlite-check-enum-synthesis',
      'sqlite-no-comments',
    ]);
  });

  it('imports: no row counts, no live health', () => {
    expect(capabilityNotesForSource({ kind: 'import' })).toEqual([
      'import-no-row-counts',
      'import-no-live-health',
    ]);
  });
});

describe('rowEstimateQualityForSource', () => {
  it('postgres/sqlite estimates render plain, mysql approximate, imports none', () => {
    expect(rowEstimateQualityForSource({ kind: 'live', engine: 'postgres' })).toBe('estimate');
    expect(rowEstimateQualityForSource({ kind: 'live', engine: 'sqlite' })).toBe('estimate');
    expect(rowEstimateQualityForSource({ kind: 'live', engine: 'mysql' })).toBe('approximate');
    expect(rowEstimateQualityForSource({ kind: 'import' })).toBe('none');
  });
});
