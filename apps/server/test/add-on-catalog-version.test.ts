// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `EXACT_VERSION_PATTERN` guards which add-on and app versions the installer will
 * accept from the catalogue, so it runs against strings this process did not
 * write. It used to repeat `[-+][0-9A-Za-z.-]+`, and because the tail class also
 * contains `-`, `-a-b` could be one segment or two: a version that fails to match
 * backtracks through every split. `0.0.0+` with 22 `--` pairs took 9.7 SECONDS to
 * reject, 18 pairs took 207 ms, 14 took 4 ms — a clean doubling.
 *
 * The timing test below is the regression guard. Its budget is deliberately far
 * above what the fixed pattern needs (microseconds) and far below what the old
 * one took, so it answers the question "did someone reintroduce the ambiguity"
 * rather than "is this machine busy".
 */
import { EXACT_VERSION_PATTERN } from '../src/add-ons/catalog.js';
import { describe, expect, it } from 'vitest';

describe('EXACT_VERSION_PATTERN', () => {
  it('accepts the exact versions a catalogue entry may carry', () => {
    for (const version of [
      '0.0.0',
      '1.2.3',
      '10.20.30',
      '1.2.3-alpha',
      '1.2.3-alpha.1',
      '1.2.3+build',
      '1.2.3-alpha+build',
      '1.2.3-rc.1+2026.09.18',
      '1.2.3-a-b',
    ]) {
      expect(EXACT_VERSION_PATTERN.test(version), version).toBe(true);
    }
  });

  it('rejects ranges, `latest`, and malformed cores', () => {
    for (const version of [
      'latest',
      '^1.2.3',
      '~1.2.3',
      '1.2',
      '1.2.3.4',
      '01.2.3',
      '1.2.3-',
      '1.2.3+',
      '',
      'v1.2.3',
    ]) {
      expect(EXACT_VERSION_PATTERN.test(version), version).toBe(false);
    }
  });

  it('rejects a backtracking payload in linear time', () => {
    // The shape that took ~10s: a valid core, then a tail the pattern must walk
    // and finally refuse. Each added pair doubled the old pattern's work.
    const payload = `0.0.0+${'--'.repeat(24)}!`;
    const started = performance.now();
    expect(EXACT_VERSION_PATTERN.test(payload)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
