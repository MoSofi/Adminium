// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-engine capability copy (M9-T04). This module owns no facts — the matrix
 * in `@adminium/engine` does — so what is tested is the two places it could
 * still lie.
 *
 * The SOURCE classification: a schema file is `import` and has no engine, and a
 * dialect the matrix does not know is `import` too, because claiming a live
 * capability for an unknown engine is how the tables list ends up promising row
 * counts nothing can produce.
 *
 * The TOOLTIP selection: which of "no live database", "run ANALYZE",
 * "no estimate" and "±40%" a row-count cell explains itself with. Four
 * different reasons for an em-dash or a `≈`, and the wrong one sends the reader
 * to fix the wrong thing.
 */
import { describe, expect, it } from 'vitest';

import {
  capabilityNoteCopy,
  capabilityNotes,
  modelCapabilitySource,
  rowEstimateQuality,
  rowEstimateTooltip,
  wizardCapabilitySource,
} from './capabilityNotes.js';
import type { WizardState } from './wizardState.js';

const wizard = (overrides: Partial<WizardState>): WizardState =>
  ({ mode: 'fields', engine: 'postgres', dsn: '', ...overrides }) as WizardState;

describe('wizardCapabilitySource', () => {
  it('classifies a schema-file wizard as an import, with no engine', () => {
    expect(wizardCapabilitySource(wizard({ mode: 'file' }))).toEqual({ kind: 'import' });
  });

  it('reads the engine off a live wizard', () => {
    expect(wizardCapabilitySource(wizard({ mode: 'fields', engine: 'mysql' }))).toEqual({
      kind: 'live',
      engine: 'mysql',
    });
  });

  it('derives the engine from a DSN wizard', () => {
    expect(wizardCapabilitySource(wizard({ mode: 'dsn', dsn: 'mysql://u@h/db' }))).toEqual({
      kind: 'live',
      engine: 'mysql',
    });
  });
});

describe('modelCapabilitySource', () => {
  it('classifies a schema-file model as an import whatever its dialect says', () => {
    expect(modelCapabilitySource({ dialect: 'postgres', source: { kind: 'import' } })).toEqual({
      kind: 'import',
    });
  });

  it('classifies a live model by its dialect', () => {
    expect(modelCapabilitySource({ dialect: 'sqlite', source: { kind: 'live' } })).toEqual({
      kind: 'live',
      engine: 'sqlite',
    });
    expect(modelCapabilitySource({ dialect: 'postgres' })).toEqual({ kind: 'live', engine: 'postgres' });
  });

  it('falls back to `import` for a dialect the matrix does not know', () => {
    // Claiming a live capability for an engine nothing has measured is worse
    // than admitting there is no live source.
    expect(modelCapabilitySource({ dialect: 'duckdb', source: { kind: 'live' } })).toEqual({
      kind: 'import',
    });
  });
});

describe('capabilityNotes', () => {
  it('translates each note the matrix reports for MySQL', () => {
    const notes = capabilityNotes({ kind: 'live', engine: 'mysql' });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).toContain(capabilityNoteCopy('mysql-approximate-row-estimates'));
    expect(notes).toContain(capabilityNoteCopy('mysql-weaker-fk-enum-metadata'));
  });

  it('reports the schema-file limits for an import source', () => {
    const notes = capabilityNotes({ kind: 'import' });
    expect(notes).toContain(capabilityNoteCopy('import-no-row-counts'));
    expect(notes).toContain(capabilityNoteCopy('import-no-live-health'));
  });

  it('has no note that reads as a bare code', () => {
    // Every branch of `capabilityNoteCopy` returns prose; a missing case would
    // surface here as the code itself reaching the screen.
    for (const engine of ['postgres', 'mysql', 'sqlite'] as const) {
      for (const note of capabilityNotes({ kind: 'live', engine })) {
        expect(note).not.toMatch(/^[a-z]+(-[a-z]+)+$/);
        expect(note.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('rowEstimateQuality', () => {
  it('grades the three live engines and the file source', () => {
    expect(rowEstimateQuality({ kind: 'import' })).toBe('none');
    expect(rowEstimateQuality({ kind: 'live', engine: 'mysql' })).toBe('approximate');
    expect(rowEstimateQuality({ kind: 'live', engine: 'postgres' })).not.toBe('none');
  });
});

describe('rowEstimateTooltip', () => {
  it('explains that a schema file has no live database at all', () => {
    expect(rowEstimateTooltip({ kind: 'import' }, null)).toContain('Schema files have no live database');
    // …and says the same thing even when a number was somehow supplied.
    expect(rowEstimateTooltip({ kind: 'import' }, 42)).toContain('Schema files have no live database');
  });

  it('points a SQLite user at ANALYZE, which is what actually fixes it', () => {
    expect(rowEstimateTooltip({ kind: 'live', engine: 'sqlite' }, null)).toContain('run ANALYZE');
  });

  it('says the engine reported nothing for the other live engines', () => {
    expect(rowEstimateTooltip({ kind: 'live', engine: 'postgres' }, null)).toContain('no estimate');
    expect(rowEstimateTooltip({ kind: 'live', engine: 'mysql' }, null)).toContain('no estimate');
  });

  it('warns about the drift on an approximate count', () => {
    expect(rowEstimateTooltip({ kind: 'live', engine: 'mysql' }, 12_000)).toContain('±40%');
  });

  it('needs no tooltip for a count that can be trusted', () => {
    expect(rowEstimateTooltip({ kind: 'live', engine: 'postgres' }, 12_000)).toBeNull();
  });
});
