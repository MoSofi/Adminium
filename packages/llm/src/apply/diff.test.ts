// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The heuristic-baseline diff engine (06-llm-assist.md §8.2) and the
 * "Accept all ≥ 0.8" bulk semantics (acceptance criterion 12).
 *
 * Golden diff: the validated demo response (§6.3) against the demo heuristic
 * baseline (§6.2) yields a stable set of `agree` / `conflict` / `llm-new` /
 * `heuristic-only` rows. Focused tests then pin the two statuses the golden
 * demo does not naturally exercise — `rejects-heuristic` (an explicit `pii:
 * null` over a heuristic flag) and `user-locked` (an existing `source: 'user'`
 * override) — and prove neither can ever enter a confidence-gated bulk set.
 */
import { readFileSync } from 'node:fs';

import { classifyModel, parseDatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { LlmResponseV1 } from '../response/schema.js';
import type { EnrichmentSet } from '../types.js';
import {
  diffEnrichment,
  isBulkAcceptable,
  selectBulkAccept,
  type SuggestionDiff,
  type SuggestionStatus,
} from './diff.js';
import { normalizeHeuristicBaseline, normalizeLlmResponse } from './normalize.js';
import {
  columnLabelId,
  copyId,
  dashboardId,
  enumId,
  groupId,
  keyId,
  piiId,
  relationId,
  tableLabelId,
  templateId,
  widgetId,
} from './suggestion-id.js';

function fixture(relative: string): string {
  return readFileSync(new URL(`../../test/fixtures/${relative}`, import.meta.url), 'utf8');
}

const model = parseDatabaseModel(fixture('demo-schema.json'));
const classified = classifyModel(model);
const response = LlmResponseV1.parse(JSON.parse(fixture('responses/valid-demo.json')));

const llm = normalizeLlmResponse(response);
const heuristic = normalizeHeuristicBaseline(model, classified);
const diff = diffEnrichment(llm, heuristic);

function byId(id: string): SuggestionDiff | undefined {
  return diff.find((d) => d.id === id);
}

function tally(rows: readonly SuggestionDiff[]): Record<SuggestionStatus, number> {
  const counts = {
    agree: 0,
    conflict: 0,
    'llm-new': 0,
    'heuristic-only': 0,
    'rejects-heuristic': 0,
    'user-locked': 0,
  } satisfies Record<SuggestionStatus, number>;
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

const PRODUCT_RELATION = relationId('public.orders', ['product_id'], 'public.products', ['id']);
const ORDERS_STATUS_ENUM = enumId('public.orders', 'status');

describe('golden diff: valid-demo vs heuristic baseline', () => {
  it('produces the expected status distribution', () => {
    expect(diff).toHaveLength(42);
    expect(tally(diff)).toEqual({
      agree: 16,
      conflict: 7,
      'llm-new': 15,
      'heuristic-only': 4,
      'rejects-heuristic': 0,
      'user-locked': 0,
    });
  });

  it('classifies each category of suggestion correctly', () => {
    // labels: humanized en_US matches → agree; the model's shorter labels → conflict;
    // a surrogate key the LLM omits → heuristic-only.
    expect(byId(tableLabelId('public.orders'))?.status).toBe('agree');
    expect(byId(columnLabelId('public.orders', 'order_number'))?.status).toBe('agree');
    expect(byId(columnLabelId('public.orders', 'customer_id'))?.status).toBe('conflict');
    expect(byId(columnLabelId('public.orders', 'total_cents'))?.status).toBe('conflict');
    expect(byId(columnLabelId('public.customers', 'created_at'))?.status).toBe('conflict');
    expect(byId(columnLabelId('public.orders', 'id'))?.status).toBe('heuristic-only');
    expect(byId(columnLabelId('public.products', 'created_at'))?.status).toBe('heuristic-only');

    // keys agree; the enum tones conflict (heuristic paid=pos vs LLM paid=accent).
    expect(byId(keyId('public.customers'))?.status).toBe('agree');
    expect(byId(ORDERS_STATUS_ENUM)?.status).toBe('conflict');

    // an inferred relation the heuristic lacks; PII both sides confirm.
    expect(byId(PRODUCT_RELATION)?.status).toBe('llm-new');
    expect(byId(piiId('public.customers', 'email'))?.status).toBe('agree');
    expect(byId(piiId('public.customers', 'full_name'))?.status).toBe('agree');

    // templates, groups, dashboards, widgets and micro-copy are all LLM-new.
    expect(byId(templateId('public.orders', 'page-queue-inbox'))?.status).toBe('llm-new');
    expect(byId(groupId('sales'))?.status).toBe('llm-new');
    expect(byId(dashboardId('revenue'))?.status).toBe('llm-new');
    expect(byId(widgetId('revenue', 'kpi-stat-card', 1))?.status).toBe('llm-new');
    expect(byId(copyId('public.orders'))?.status).toBe('llm-new');
  });

  it('tags each row with its §8.1 category and a confidence', () => {
    expect(byId(ORDERS_STATUS_ENUM)?.category).toBe('enum');
    expect(byId(ORDERS_STATUS_ENUM)?.confidence).toBe(0.97);
    expect(byId(PRODUCT_RELATION)?.category).toBe('relation');
    expect(byId(PRODUCT_RELATION)?.confidence).toBe(0.93);
    expect(byId(dashboardId('revenue'))?.confidence).toBe(0.95); // strongest widget
  });

  it('carries side-by-side values for a conflict', () => {
    const enumRow = byId(ORDERS_STATUS_ENUM);
    expect((enumRow?.llmValue as { tones: Record<string, string> }).tones['paid']).toBe('accent');
    expect((enumRow?.heuristicValue as { tones: Record<string, string> }).tones['paid']).toBe('pos');
  });

  it('is deterministic and stably ordered', () => {
    expect(diffEnrichment(llm, heuristic)).toEqual(diff);
  });
});

describe('bulk accept ("Accept all ≥ 0.8")', () => {
  const accepted = selectBulkAccept(diff);

  it('selects only high-confidence conflict and llm-new rows', () => {
    expect(accepted).toHaveLength(19);
    // included: the conflicting enum + the strong inferred relation.
    expect(accepted).toContain(ORDERS_STATUS_ENUM);
    expect(accepted).toContain(PRODUCT_RELATION);
    expect(accepted).toContain(groupId('sales'));
    expect(accepted).toContain(widgetId('revenue', 'kpi-stat-card', 1));
  });

  it('excludes agree, heuristic-only and sub-threshold rows', () => {
    // agree is pre-accepted separately, not via the confidence slider.
    expect(accepted).not.toContain(tableLabelId('public.orders'));
    expect(accepted).not.toContain(columnLabelId('public.orders', 'id')); // heuristic-only
    expect(accepted).not.toContain(templateId('public.orders', 'page-board')); // 0.60
    expect(accepted).not.toContain(templateId('public.customers', 'page-directory')); // 0.55
    expect(accepted).not.toContain(widgetId('revenue', 'top-movers-list', 5)); // 0.72
  });

  it('honors a custom threshold', () => {
    const strict = selectBulkAccept(diff, 0.96);
    expect(strict).toContain(ORDERS_STATUS_ENUM); // 0.97
    expect(strict).not.toContain(PRODUCT_RELATION); // 0.93
  });
});

describe('rejects-heuristic (explicit pii: null over a heuristic flag)', () => {
  const heuristicSet: EnrichmentSet = {
    source: 'heuristic',
    tables: {
      'public.users': {
        label: { en_US: 'Users' },
        templates: [],
        confidence: 0.5,
        columns: {
          last_ip: {
            label: { en_US: 'Last Ip' },
            pii: { kind: 'ip', masking: 'mask-partial', reason: 'heuristic ip flag', confidence: 0.99 },
          },
        },
      },
    },
    enums: {},
    inferredRelations: [],
    suppressedRelations: [],
    navGroups: [],
    dashboards: [],
  };
  const llmSet: EnrichmentSet = {
    source: 'llm',
    tables: {
      'public.users': {
        label: { en_US: 'Users' },
        description: { en_US: 'Accounts.' },
        icon: 'users',
        displayColumn: null,
        naturalKey: null,
        templates: [],
        confidence: 0.9,
        columns: { last_ip: { label: { en_US: 'Last IP' }, pii: null } },
      },
    },
    enums: {},
    inferredRelations: [],
    suppressedRelations: [],
    navGroups: [],
    dashboards: [],
  };

  it('marks the cleared flag rejects-heuristic and never bulk-selects it', () => {
    const rows = diffEnrichment(llmSet, heuristicSet);
    const rejection = rows.find((r) => r.id === piiId('public.users', 'last_ip'));
    expect(rejection?.status).toBe('rejects-heuristic');
    expect(rejection?.confidence).toBe(0.99); // high, yet still excluded
    expect(rejection?.llmValue).toBeNull();
    expect(isBulkAcceptable(rejection!)).toBe(false);
    expect(selectBulkAccept(rows)).not.toContain(piiId('public.users', 'last_ip'));
  });
});

describe('suppressed declared FK (correct:false) is rejects-heuristic (finding 8)', () => {
  const suppressed = {
    fromTable: 'public.orders',
    fromColumns: ['customer_id'],
    toTable: 'public.customers',
    toColumns: ['id'],
    semantics: 'orders belong to customers',
    correct: false,
    confidence: 0.99,
  };
  const emptySet = (source: 'heuristic' | 'llm'): EnrichmentSet => ({
    source,
    tables: {},
    enums: {},
    inferredRelations: [],
    suppressedRelations: [],
    navGroups: [],
    dashboards: [],
  });
  const llmSet: EnrichmentSet = { ...emptySet('llm'), suppressedRelations: [suppressed] };
  const heuristicSet = emptySet('heuristic');
  const id = relationId('public.orders', ['customer_id'], 'public.customers', ['id']);

  it('emits a rejects-heuristic relation row the bulk-accept gate can never select', () => {
    const rows = diffEnrichment(llmSet, heuristicSet);
    const rejection = rows.find((r) => r.id === id);
    expect(rejection?.status).toBe('rejects-heuristic');
    expect(rejection?.category).toBe('relation');
    expect(rejection?.confidence).toBe(0.99);
    expect((rejection?.llmValue as { correct: boolean }).correct).toBe(false);
    expect(isBulkAcceptable(rejection!)).toBe(false);
    expect(selectBulkAccept(rows)).not.toContain(id);
  });
});

describe('pii masking downgrade is a conflict, not a collapsed agree (finding 9)', () => {
  function usersSet(source: 'heuristic' | 'llm', masking: string): EnrichmentSet {
    return {
      source,
      tables: {
        'public.users': {
          label: { en_US: 'Users' },
          templates: [],
          confidence: source === 'llm' ? 0.9 : 0.5,
          columns: {
            email: {
              label: { en_US: 'Email' },
              pii: { kind: 'email', masking: masking as never, reason: 'email column', confidence: 0.95 },
            },
          },
        },
      },
      enums: {},
      inferredRelations: [],
      suppressedRelations: [],
      navGroups: [],
      dashboards: [],
    };
  }

  it('flags an unmasking (mask-email → none) as conflict so it is reviewed, not pre-accepted', () => {
    const rows = diffEnrichment(usersSet('llm', 'none'), usersSet('heuristic', 'mask-email'));
    const pii = rows.find((r) => r.id === piiId('public.users', 'email'));
    expect(pii?.status).toBe('conflict');
    expect((pii?.llmValue as { masking: string }).masking).toBe('none');
    expect((pii?.heuristicValue as { masking: string }).masking).toBe('mask-email');
  });

  it('still collapses to agree when kind AND masking match', () => {
    const rows = diffEnrichment(usersSet('llm', 'mask-email'), usersSet('heuristic', 'mask-email'));
    expect(rows.find((r) => r.id === piiId('public.users', 'email'))?.status).toBe('agree');
  });
});

describe('user-locked (existing source: "user" override)', () => {
  it('overrides status, surfaces currentValue, and excludes from bulk accept', () => {
    const override = { kind: 'category', tones: {} };
    const locked = diffEnrichment(llm, heuristic, {
      userLockedIds: [ORDERS_STATUS_ENUM],
      currentValues: { [ORDERS_STATUS_ENUM]: override },
    });
    const row = locked.find((r) => r.id === ORDERS_STATUS_ENUM);
    expect(row?.status).toBe('user-locked');
    expect(row?.currentValue).toEqual(override);

    // the enum was in the ≥0.8 bulk set (0.97) before locking; now it must not be.
    expect(selectBulkAccept(diff)).toContain(ORDERS_STATUS_ENUM);
    expect(selectBulkAccept(locked)).not.toContain(ORDERS_STATUS_ENUM);
  });
});

describe('selectBulkAccept semantics (acceptance criterion 12)', () => {
  it('picks conflict/llm-new above threshold and excludes rejects/locked/agree/low', () => {
    const rows: SuggestionDiff[] = [
      { id: 'a', category: 'enum', status: 'conflict', llmValue: 1, heuristicValue: 2, confidence: 0.99 },
      { id: 'b', category: 'pii', status: 'rejects-heuristic', llmValue: null, heuristicValue: {}, confidence: 0.99 },
      { id: 'c', category: 'label', status: 'user-locked', llmValue: 1, heuristicValue: 2, confidence: 0.99 },
      { id: 'd', category: 'label', status: 'llm-new', llmValue: 1, heuristicValue: undefined, confidence: 0.99 },
      { id: 'e', category: 'label', status: 'agree', llmValue: 1, heuristicValue: 1, confidence: 0.99 },
      { id: 'f', category: 'label', status: 'llm-new', llmValue: 1, heuristicValue: undefined, confidence: 0.5 },
    ];
    expect(selectBulkAccept(rows)).toEqual(['a', 'd']);
  });
});
