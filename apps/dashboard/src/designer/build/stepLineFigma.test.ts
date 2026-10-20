// SPDX-License-Identifier: AGPL-3.0-only
/**
 * read_figma's step line: the part it read, the reads it cost said
 * after it, the saved copy said as free, a read that did not happen said plainly, and the line under
 * the turn while Figma has paused the person's reads.
 */
import { describe, expect, it } from 'vitest';

import { figmaPausedLine, stepCost, stepLine, SUBJECT } from './stepLine.js';
import type { StepRow } from './turns.js';

const row = (over: Partial<StepRow>): StepRow => ({ id: '1', tool: 'read_figma', label: 'x', state: 'done', ms: 10, detail: null, folded: 1, subject: 'Header', ...over });

describe('read_figma’s line', () => {
  it('names the part, and what the read cost', () => {
    expect(stepLine(row({ state: 'running' }))).toBe(`Reading ${SUBJECT} from Figma`);
    expect(stepLine(row({ count: 1 }))).toBe(`Read ${SUBJECT} from Figma`);
    expect(stepCost(row({ count: 1 }))).toBe(' (1 Figma read)');
    expect(stepCost(row({ count: 2 }))).toBe(' (2 Figma reads)');
    expect(stepLine(row({ count: 0 }))).toBe(`Read ${SUBJECT} from the saved copy`);
    expect(stepCost(row({ count: 0 }))).toBeNull();
    expect(stepLine(row({ state: 'missed', outcome: 'refused' }))).toBe('Did not read Figma');
    expect(stepLine(row({ state: 'failed' }))).toBe('Did not read Figma');
    expect(stepCost(row({ tool: 'read_file', count: 3 }))).toBeNull();
  });

  it('says once under the turn until when Figma reads are paused', () => {
    const until = Date.UTC(2026, 10, 1, 12);
    expect(figmaPausedLine([row({ count: 1 })])).toBeNull();
    expect(figmaPausedLine([row({ state: 'missed', until, dated: true })], 'en-GB')).toBe('Figma reads are paused for you until 1 November 2026. The Designer works from the design document you imported.');
    expect(figmaPausedLine([row({ state: 'missed', dated: false })])).toBe('Figma reads are paused for you until next month. The Designer works from the design document you imported.');
  });
});
