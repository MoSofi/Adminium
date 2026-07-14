/**
 * Pure enrich-step rules (06-llm-assist.md §10.2, §7.5) — section/locale
 * toggles, provider-card gating, request shaping, the BYO merge gate, the §7.5
 * repair message, and prompt filenames. No DOM.
 */
import { describe, expect, it } from 'vitest';

import {
  allChunksValid,
  defaultEnrichChoices,
  ENRICH_LOCALES,
  ENRICH_SECTIONS,
  formatRepairMessage,
  LOCKED_LOCALE,
  promptFileName,
  providerCardEnabled,
  REPAIR_ERROR_LIMIT,
  runModeForIntent,
  SAMPLING_MAX_VALUES,
  toCreateRunInput,
  toggleLocale,
  toggleSection,
  type ChunkStatus,
} from './enrichState.js';

describe('sections', () => {
  it('defaults to all ten decision groups, sample-free, en_US only', () => {
    const choices = defaultEnrichChoices();
    expect(choices.sections).toHaveLength(10);
    expect(choices.sections).toEqual([...ENRICH_SECTIONS]);
    expect(choices.locales).toEqual([LOCKED_LOCALE]);
    expect(choices.sampling).toBe(false);
  });

  it('toggles a section off and back on, preserving canonical order', () => {
    const without = toggleSection([...ENRICH_SECTIONS], 'enums');
    expect(without).not.toContain('enums');
    expect(without).toHaveLength(9);

    const back = toggleSection(without, 'enums');
    // Order is restored to the canonical §4.4 order, not append order.
    expect(back).toEqual([...ENRICH_SECTIONS]);
  });

  it('adds a section to an empty selection', () => {
    expect(toggleSection([], 'widgets')).toEqual(['widgets']);
  });
});

describe('locales', () => {
  it('en_US sorts first and is the locked default', () => {
    expect(ENRICH_LOCALES[0]).toBe('en_US');
    expect(LOCKED_LOCALE).toBe('en_US');
  });

  it('adds and removes non-locked locales in registry order', () => {
    const withDe = toggleLocale(['en_US'], 'de_DE');
    expect(withDe).toEqual(['en_US', 'de_DE']);

    const removed = toggleLocale(withDe, 'de_DE');
    expect(removed).toEqual(['en_US']);
  });

  it('never removes the locked en_US locale', () => {
    expect(toggleLocale(['en_US'], 'en_US')).toEqual(['en_US']);
    expect(toggleLocale(['en_US', 'de_DE'], 'en_US')).toEqual(['en_US', 'de_DE']);
  });

  it('always re-adds en_US even if a caller dropped it', () => {
    const result = toggleLocale(['de_DE'], 'fr_FR');
    expect(result).toContain('en_US');
    expect(result).toContain('de_DE');
    expect(result).toContain('fr_FR');
    // Canonical order: en_US before de_DE before fr_FR.
    expect(result.indexOf('en_US')).toBeLessThan(result.indexOf('de_DE'));
    expect(result.indexOf('de_DE')).toBeLessThan(result.indexOf('fr_FR'));
  });
});

describe('providerCardEnabled', () => {
  it('needs a configured provider, a live connection, and a non-file source', () => {
    expect(providerCardEnabled({ providerConfigured: true, connectionId: 'c1', sourceIsFile: false })).toBe(true);
    expect(providerCardEnabled({ providerConfigured: false, connectionId: 'c1', sourceIsFile: false })).toBe(false);
    expect(providerCardEnabled({ providerConfigured: true, connectionId: null, sourceIsFile: false })).toBe(false);
    expect(providerCardEnabled({ providerConfigured: true, connectionId: 'c1', sourceIsFile: true })).toBe(false);
  });
});

describe('toCreateRunInput', () => {
  it('maps the shared choices to a POST /runs body; sampling off ⇒ null', () => {
    const body = toCreateRunInput('conn_1', 'byo', {
      sections: ['labels', 'enums'],
      locales: ['en_US', 'de_DE'],
      sampling: false,
    });
    expect(body).toEqual({
      connectionId: 'conn_1',
      path: 'byo',
      sections: ['labels', 'enums'],
      locales: ['en_US', 'de_DE'],
      sampling: null,
    });
  });

  it('sampling on ⇒ the default per-column cap', () => {
    const body = toCreateRunInput('conn_1', 'provider', {
      sections: [...ENRICH_SECTIONS],
      locales: ['en_US'],
      sampling: true,
    });
    expect(body.sampling).toEqual({ maxValuesPerColumn: SAMPLING_MAX_VALUES });
    expect(body.path).toBe('provider');
  });

  it('runModeForIntent is identity for the two run paths', () => {
    expect(runModeForIntent('provider')).toBe('provider');
    expect(runModeForIntent('byo')).toBe('byo');
  });
});

describe('allChunksValid (BYO merge gate)', () => {
  it('unlocks only when every chunk validated', () => {
    expect(allChunksValid(['valid'])).toBe(true);
    expect(allChunksValid(['valid', 'valid'])).toBe(true);
    expect(allChunksValid(['valid', 'error'])).toBe(false);
    expect(allChunksValid(['valid', 'empty'])).toBe(false);
    expect(allChunksValid(['valid', 'validating'])).toBe(false);
  });

  it('is false for an empty chunk set', () => {
    expect(allChunksValid([] as ChunkStatus[])).toBe(false);
  });
});

describe('formatRepairMessage (§7.5)', () => {
  it('renders the verbatim repair turn with code · path · message', () => {
    const message = formatRepairMessage([
      { code: 'LLM_SCHEMA_INVALID', path: 'tables[3].label', message: 'Missing en_US key.' },
      { code: 'LLM_UNKNOWN_TABLE', path: '', message: 'public.foo does not exist.' },
    ]);
    expect(message).toContain('Your previous response failed machine validation:');
    expect(message).toContain('LLM_SCHEMA_INVALID at tables[3].label: Missing en_US key.');
    // Root-level errors label the location as (root).
    expect(message).toContain('LLM_UNKNOWN_TABLE at (root): public.foo does not exist.');
    expect(message).toContain('Return the corrected COMPLETE JSON object now.');
    expect(message).toContain('schema_version first.');
  });

  it('caps the listed errors at the repair limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      code: 'E',
      path: `p${i}`,
      message: `m${i}`,
    }));
    const message = formatRepairMessage(many);
    expect(message).toContain('p0');
    expect(message).toContain(`p${REPAIR_ERROR_LIMIT - 1}`);
    expect(message).not.toContain(`p${REPAIR_ERROR_LIMIT}`);
  });
});

describe('promptFileName', () => {
  it('is unchunked when total ≤ 1', () => {
    expect(promptFileName('run_1', 1, 1)).toBe('adminium-prompt-run_1.md');
  });

  it('carries the chunk position when split', () => {
    expect(promptFileName('run_1', 2, 3)).toBe('adminium-prompt-run_1-chunk-2of3.md');
  });
});
