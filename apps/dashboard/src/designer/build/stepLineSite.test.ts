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
  it('says each of its steps as what it is: reading, the plan, and only then building', () => {
    expect(stepLine(row({ state: 'running' }))).toBe(`Working from the template ${SUBJECT}`);
    // The first call only reads what the template holds (seen 2026-11-27: it read "Built 5 screens" before anything was built).
    expect(stepLine(row({ count: 5 }))).toBe(`Read what ${SUBJECT} holds: 5 pages`);
    expect(stepLine(row({ count: 1 }))).toBe(`Read what ${SUBJECT} holds: 1 page`);
    expect(stepLine(row({}))).toBe(`Read what ${SUBJECT} holds: 0 pages`);
    // The plan, sent back or approved while the side is still to be made.
    expect(stepLine(row({ outcome: 'declined' }))).toBe(`The plan for ${SUBJECT} came back with your changes`);
    expect(stepLine(row({ outcome: 'added' }))).toBe(`The plan for ${SUBJECT} is approved`);
    // Built.
    expect(stepLine(row({ count: 1, outcome: 'added' }))).toBe(`Built 1 screen from ${SUBJECT}`);
    expect(stepLine(row({ count: 9, outcome: 'added' }))).toBe(`Built 9 screens from ${SUBJECT}`);
    expect(stepCost(row({ count: 9, outcome: 'added' }))).toBeNull();
  });

  it('says a stylesheet’s look was brought in, where no screen was made from it', () => {
    expect(stepLine(row({ count: 0, outcome: 'added' }))).toBe(`Brought in the look of ${SUBJECT}`);
  });

  it('says the template’s own name was read, where name_app was handed its titles before a name was taken', () => {
    const naming = (over: Partial<StepRow>): StepRow => row({ tool: 'name_app', subject: 'Site Studio', ...over });
    expect(stepLine(naming({ outcome: 'declined' }))).toBe('Read what the template calls itself');
    expect(stepLine(naming({}))).toBe(`Named the app ${SUBJECT}`);
    expect(stepLine(naming({ state: 'failed' }))).toBe('The app was not named');
  });

  it('says it did not build when the step failed or was refused, and Stopped when the turn was', () => {
    expect(stepLine(row({ state: 'failed' }))).toBe('Did not build from the template');
    expect(stepLine(row({ outcome: 'refused' }))).toBe('Did not build from the template');
    expect(stepLine(row({ state: 'failed', ended: 'stopped' }))).toBe('Stopped');
  });
});
