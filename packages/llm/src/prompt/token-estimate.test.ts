/** `chars / 3.6` token estimator (06-llm-assist.md §4.5). */
import { describe, expect, it } from 'vitest';

import { CHARS_PER_TOKEN, estimateTokens } from './token-estimate.js';

describe('estimateTokens', () => {
  it('pins the divisor at 3.6', () => {
    expect(CHARS_PER_TOKEN).toBe(3.6);
  });

  it('is 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('is ceil(chars / 3.6)', () => {
    expect(estimateTokens('x'.repeat(36))).toBe(10); // 36 / 3.6 = 10 exactly
    expect(estimateTokens('abcd')).toBe(2); // 4 / 3.6 = 1.11 → 2
    expect(estimateTokens('x'.repeat(360))).toBe(100);
  });

  it('rounds up any partial token', () => {
    expect(estimateTokens('x')).toBe(1);
  });
});
