// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Inspector field derivation (04-T14): the config inspector's fields are
 * generated from a widget's Zod config schema — primitive kinds only, composite
 * fields skipped, locked paths flagged.
 */
import { describe, expect, it } from 'vitest';
import { getWidget } from '@adminium/widgets';

import { deriveInspectorFields } from './inspectorFields.js';

const kpi = getWidget('kpi-stat-card');

describe('deriveInspectorFields (kpi-stat-card schema)', () => {
  it('classifies primitive fields by Zod type', () => {
    expect(kpi).toBeDefined();
    const fields = deriveInspectorFields(kpi!.configSchema);
    const byKey = new Map(fields.map((field) => [field.key, field]));

    expect(byKey.get('title')?.kind).toBe('text');
    expect(byKey.get('showSparkline')?.kind).toBe('boolean');

    const metricFormat = byKey.get('metricFormat');
    expect(metricFormat?.kind).toBe('enum');
    if (metricFormat?.kind === 'enum') {
      expect(metricFormat.options).toContain('currency');
    }

    const refresh = byKey.get('refreshInterval');
    expect(refresh?.kind).toBe('number');
    if (refresh?.kind === 'number') {
      expect(refresh.min).toBe(5);
      expect(refresh.max).toBe(86_400);
    }
  });

  it('skips composite and internal fields', () => {
    const keys = deriveInspectorFields(kpi!.configSchema).map((field) => field.key);
    expect(keys).not.toContain('binding');
    expect(keys).not.toContain('format');
    expect(keys).not.toContain('emptyState');
    expect(keys).not.toContain('permissions');
    expect(keys).not.toContain('testId');
  });

  it('flags locked paths and leaves the rest editable', () => {
    const fields = deriveInspectorFields(kpi!.configSchema, ['metricFormat']);
    const locked = fields.find((field) => field.key === 'metricFormat');
    const open = fields.find((field) => field.key === 'title');
    expect(locked?.locked).toBe(true);
    expect(open?.locked).toBe(false);
  });
});
