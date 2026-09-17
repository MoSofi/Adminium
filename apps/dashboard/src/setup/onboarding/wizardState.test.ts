// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six-step order and what may be skipped.
 *
 * These are product decisions, not rendering: the account step is third so the
 * two before it can be answered with no instance to write to (45 R1), and it
 * is the one step that can never be skipped, because everything after it needs
 * the session its submit mints. Asserting that here means a reorder has to be
 * deliberate rather than a diff nobody reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import {
  ONBOARDING_STEP_IDS,
  isSkippable,
  onboardingStepDefs,
  progressPercent,
  stepAfter,
  stepBefore,
  stepIndexOf,
} from './wizardState.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('the order', () => {
  it('asks what you will build, then the database, then the account', () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual([
      'start',
      'connect',
      'account',
      'meta',
      'team',
      'done',
    ]);
  });

  it('walks forward and back, and stops at both ends', () => {
    expect(stepBefore('start')).toBeNull();
    expect(stepAfter('start')).toBe('connect');
    expect(stepAfter('account')).toBe('meta');
    expect(stepBefore('done')).toBe('team');
    // `null`, not a wrap or a clamp: the caller LEAVES the wizard here.
    expect(stepAfter('done')).toBeNull();
  });
});

describe('what may be skipped', () => {
  it('never lets the account or the storage choice be skipped', () => {
    expect(isSkippable('account')).toBe(false);
    // Continuing IS the answer — a Skip beside a chosen default would imply
    // the default were not one.
    expect(isSkippable('meta')).toBe(false);
    expect(isSkippable('done')).toBe(false);
  });

  it('lets the three optional ones be skipped', () => {
    expect(isSkippable('start')).toBe(true);
    expect(isSkippable('connect')).toBe(true);
    expect(isSkippable('team')).toBe(true);
  });
});

describe('the step definitions', () => {
  it('numbers every kicker out of six, in order', () => {
    const defs = onboardingStepDefs();
    expect(defs).toHaveLength(6);
    defs.forEach((def, index) => {
      expect(def.kicker).toBe(`Step ${String(index + 1)} of 6`);
      expect(def.id).toBe(ONBOARDING_STEP_IDS[index]);
      expect(stepIndexOf(def.id)).toBe(index);
    });
  });

  it('gives every step a rail label, a second line and a title', () => {
    for (const def of onboardingStepDefs()) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.title.length).toBeGreaterThan(0);
    }
  });

  it('leaves only the last step without a description under the title', () => {
    const empty = onboardingStepDefs().filter((def) => def.body === '');
    expect(empty.map((def) => def.id)).toEqual(['done']);
  });

  it('names the storage step after whose data it is, not after a DSN', () => {
    const meta = onboardingStepDefs().find((def) => def.id === 'meta');
    expect(meta?.title).toBe('Where Adminium keeps its own data');
  });
});

describe('the progress bar', () => {
  it('counts the step you are ON as reached, so it never opens at zero', () => {
    expect(progressPercent('start')).toBe(17);
    expect(progressPercent('account')).toBe(50);
    expect(progressPercent('done')).toBe(100);
  });
});
