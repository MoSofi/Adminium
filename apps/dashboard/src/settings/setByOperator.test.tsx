// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Set by the operator" (plan 75 §5.1): the chip a locked setting carries
 * (Trial Mode comp, lines 272 and 307), and how a page tells a lock from the
 * reply or from a refused save.
 */
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../app/api.js';
import { installTestI18n } from '../i18n/testing.js';
import { isLocked, isSetByOperator, SetByOperatorChip } from './SetByOperator.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('SetByOperatorChip', () => {
  it('says who set it, with a lock no screen reader reads out', () => {
    render(<SetByOperatorChip data-testid="chip" />);
    const chip = screen.getByTestId('chip');
    expect(chip.textContent).toBe('Set by the operator');
    const icon = chip.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    // The comp's chip: 11.5 px bold, muted, on surface-3, fully rounded, one line.
    for (const name of ['text-[11.5px]', 'font-bold', 'text-fg-muted', 'bg-surface-3', 'rounded-full', 'whitespace-nowrap']) expect(chip.className).toContain(name);
  });
});

describe('reading a lock', () => {
  it('from the reply: locked only when it says so', () => {
    expect(isLocked(undefined)).toBe(false);
    expect(isLocked({ allowed: true, reason: null })).toBe(false);
    expect(isLocked({ allowed: false, reason: 'trial-mode' })).toBe(true);
  });

  it('from a refused save: SET_BY_OPERATOR, and nothing else', () => {
    expect(isSetByOperator(new ApiError(409, 'SET_BY_OPERATOR', 'set', 'r', { setting: 'telemetry.enabled', reason: 'trial-mode' }))).toBe(true);
    expect(isSetByOperator(new ApiError(409, 'CONFLICT', 'conflict', 'r'))).toBe(false);
    expect(isSetByOperator(new Error('SET_BY_OPERATOR'))).toBe(false);
  });
});
