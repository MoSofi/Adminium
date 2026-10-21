// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use_site's step line: building the screens from the template while it runs, how many it built,
 * and a build that did not happen said plainly.
 */
import { describe, expect, it } from 'vitest';

import { stepCost, stepLine, SUBJECT } from './stepLine.js';
import type { StepRow } from './turns.js';

const row = (over: Partial<StepRow>): StepRow => ({ id: '1', tool: 'use_site', label: 'x', state: 'done', ms: 10, detail: null, folded: 1, subject: 'harbor-bakery', ...over });

describe('use_site’s line', () => {
  it('names the template while it builds, and counts the screens it built', () => {
    expect(stepLine(row({ state: 'running' }))).toBe(`Building the screens from ${SUBJECT}`);
    expect(stepLine(row({ count: 1 }))).toBe(`Built 1 screen from ${SUBJECT}`);
    expect(stepLine(row({ count: 9 }))).toBe(`Built 9 screens from ${SUBJECT}`);
    expect(stepLine(row({}))).toBe(`Built 0 screens from ${SUBJECT}`);
    expect(stepCost(row({ count: 9 }))).toBeNull();
  });

  it('says it did not build when the step failed or was refused, and Stopped when the turn was', () => {
    expect(stepLine(row({ state: 'failed' }))).toBe('Did not build from the template');
    expect(stepLine(row({ outcome: 'refused' }))).toBe('Did not build from the template');
    expect(stepLine(row({ state: 'failed', ended: 'stopped' }))).toBe('Stopped');
  });
});
