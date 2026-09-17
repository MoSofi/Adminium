// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared contract types: provider ids, the run status machine, and a
 * constructible `EnrichmentSet`.
 */
import { describe, expect, it } from 'vitest';

import {
  isTerminalRunStatus,
  LLM_RUN_STATUSES,
  llmRunStatusSchema,
  PROVIDER_IDS,
  providerIdSchema,
  TERMINAL_LLM_RUN_STATUSES,
  type EnrichmentSet,
} from './types.js';

describe('ProviderId', () => {
  it('enumerates the provider matrix', () => {
    expect(PROVIDER_IDS).toEqual([
      'anthropic',
      'openai',
      'openai-compatible',
      'ollama',
      'adminium-managed',
    ]);
  });

  it('validates known ids and rejects unknown ones', () => {
    expect(providerIdSchema.safeParse('ollama').success).toBe(true);
    expect(providerIdSchema.safeParse('gemini').success).toBe(false);
  });
});

describe('LlmRunStatus machine', () => {
  it('enumerates the states', () => {
    expect(LLM_RUN_STATUSES).toEqual([
      'draft',
      'running',
      'awaiting_response',
      'validated',
      'applied',
      'partially_applied',
      'failed',
      'discarded',
    ]);
    expect(llmRunStatusSchema.safeParse('validated').success).toBe(true);
    expect(llmRunStatusSchema.safeParse('nope').success).toBe(false);
  });

  it('classifies terminal states', () => {
    for (const status of TERMINAL_LLM_RUN_STATUSES) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
    expect(isTerminalRunStatus('draft')).toBe(false);
    expect(isTerminalRunStatus('validated')).toBe(false);
    expect(isTerminalRunStatus('awaiting_response')).toBe(false);
  });
});

describe('EnrichmentSet shape', () => {
  it('is constructible as a normalized llm set', () => {
    const set: EnrichmentSet = {
      source: 'llm',
      llmRunId: '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A',
      tables: {
        'public.orders': {
          label: { en_US: 'Orders', de_DE: 'Bestellungen' },
          icon: 'shopping-cart',
          displayColumn: 'order_number',
          naturalKey: ['order_number'],
          templates: [{ template: 'page-queue-inbox', rank: 1, confidence: 0.82 }],
          columns: {
            total_cents: { label: { en_US: 'Total' }, pii: null },
          },
          confidence: 0.95,
        },
      },
      enums: {},
      inferredRelations: [],
      suppressedRelations: [],
      navGroups: [],
      dashboards: [],
    };
    expect(set.source).toBe('llm');
    expect(set.tables['public.orders']?.templates[0]?.template).toBe('page-queue-inbox');
  });
});
