// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Metric formatting + delta computation units (annex §1 `format`,
 * `deltaMode`). Locale pinned to en-US for deterministic output.
 */
import { describe, expect, it } from 'vitest';

import { computeDelta, formatMetricValue } from './format.js';

const EN = { locale: 'en-US' };

describe('formatMetricValue', () => {
  it('formats currency with compact notation above 100k', () => {
    expect(formatMetricValue(48_210, 'currency', EN)).toBe('$48,210');
    expect(formatMetricValue(1_250_000, 'currency', EN)).toBe('$1.3M');
    expect(formatMetricValue(12.5, 'currency', EN)).toBe('$12.50');
    expect(formatMetricValue(950, 'currency', { ...EN, currency: 'EUR' })).toBe('€950.00');
  });

  it('formats percent from fractions and compact large numbers', () => {
    expect(formatMetricValue(0.032, 'percent', EN)).toBe('3.2%');
    expect(formatMetricValue(0.74, 'percent', EN)).toBe('74%');
    expect(formatMetricValue(48_210, 'compact', EN)).toBe('48.2K');
    expect(formatMetricValue(1234.567, 'plain', EN)).toBe('1,234.57');
  });

  it('formats durations from seconds', () => {
    expect(formatMetricValue(45, 'duration')).toBe('45s');
    expect(formatMetricValue(200, 'duration')).toBe('3m 20s');
    expect(formatMetricValue(8040, 'duration')).toBe('2h 14m');
    expect(formatMetricValue(100 * 3600, 'duration')).toBe('4d 4h');
  });
});

describe('computeDelta', () => {
  it('derives pct trend and signed text from value vs prior', () => {
    const delta = computeDelta({ value: 1250, prior: 1000 }, 'pct', 'plain', EN);
    expect(delta).toMatchObject({ trend: 'up', text: '+25%' });
    const down = computeDelta({ value: 900, prior: 1000 }, 'pct', 'plain', EN);
    expect(down).toMatchObject({ trend: 'down', text: '-10%' });
  });

  it('is flat at (near-)zero change and null when uncomputable', () => {
    expect(computeDelta({ value: 1000, prior: 1000 }, 'pct', 'plain', EN)?.trend).toBe('flat');
    expect(computeDelta({ value: 10 }, 'pct')).toBeNull();
    expect(computeDelta({ value: 10, prior: 0 }, 'pct')).toBeNull();
    expect(computeDelta({ value: 10, prior: 5 }, 'none')).toBeNull();
  });

  it('prefers a server-provided deltaPct and formats abs mode with the metric format', () => {
    expect(computeDelta({ value: 5, deltaPct: -0.124 }, 'pct', 'plain', EN)?.text).toBe('-12.4%');
    const abs = computeDelta({ value: 1250, prior: 1000 }, 'abs', 'currency', EN);
    expect(abs).toMatchObject({ trend: 'up', text: '+$250.00' });
  });
});
