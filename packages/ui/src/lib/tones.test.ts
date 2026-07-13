import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATUS_TONES,
  TONES,
  glassBar,
  registerStatusTones,
  statusTone,
  toneMixBorderClasses,
  toneSoftClasses,
  toneSolidClasses,
} from './tones.js';

describe('tones', () => {
  it('covers every tone in the soft/solid/border maps', () => {
    for (const tone of TONES) {
      expect(toneSoftClasses[tone]).toBeTruthy();
      expect(toneSolidClasses[tone]).toBeTruthy();
      expect(toneMixBorderClasses[tone]).toBeTruthy();
    }
  });

  it('exports the glassBar recipe with the 82% color-mix', () => {
    expect(glassBar).toContain('color-mix');
    expect(glassBar).toContain('backdrop-blur');
  });
});

describe('statusTone registry', () => {
  it('resolves defaults case-insensitively', () => {
    expect(statusTone('paid')).toBe('pos');
    expect(statusTone('PAID')).toBe('pos');
    expect(statusTone('past_due')).toBe('warn');
    expect(statusTone('canceled')).toBe('danger');
    expect(statusTone('running')).toBe('info');
    expect(statusTone('draft')).toBe('neutral');
  });

  it('falls back for unknown statuses', () => {
    expect(statusTone('totally_custom')).toBe('neutral');
    expect(statusTone('totally_custom', 'accent')).toBe('accent');
  });

  it('registerStatusTones merges idempotently without touching the frozen defaults', () => {
    registerStatusTones({ Urgent: 'danger' });
    registerStatusTones({ urgent: 'danger' });
    expect(statusTone('urgent')).toBe('danger');
    expect(statusTone('URGENT')).toBe('danger');
    expect(Object.isFrozen(DEFAULT_STATUS_TONES)).toBe(true);
    expect(DEFAULT_STATUS_TONES['urgent']).toBeUndefined();
  });
});
