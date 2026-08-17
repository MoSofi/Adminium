// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Normalization to the shared `EnrichmentSet` (06-llm-assist.md §7.1).
 *
 * Locks:
 *  - the validated demo response (§6.3) normalizes into the LLM `EnrichmentSet`
 *    with labels, keys, PII, enums, inferred relations, groups and dashboards
 *    intact and correctly keyed;
 *  - the demo heuristic classification normalizes into the baseline set with
 *    humanized labels, shape icons, display/natural keys, PII flags and the
 *    workflow enum — the material the diff (§8.2) compares against.
 */
import { readFileSync } from 'node:fs';

import { classifyModel, parseDatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { LlmResponseV1 } from '../response/schema.js';
import { normalizeHeuristicBaseline, normalizeLlmResponse } from './normalize.js';

function fixture(relative: string): string {
  return readFileSync(new URL(`../../test/fixtures/${relative}`, import.meta.url), 'utf8');
}

const model = parseDatabaseModel(fixture('demo-schema.json'));
const classified = classifyModel(model);
const response = LlmResponseV1.parse(JSON.parse(fixture('responses/valid-demo.json')));

describe('normalizeLlmResponse', () => {
  const set = normalizeLlmResponse(response);

  it('tags the source and carries the response run id', () => {
    expect(set.source).toBe('llm');
    expect(set.llmRunId).toBe('01J9ZK3W8E2Q4R6T8V0X2Y4Z6A');
  });

  it('keys tables by "schema.table" and preserves localized labels + refinements', () => {
    const orders = set.tables['public.orders'];
    expect(orders?.label).toEqual({ en_US: 'Orders', de_DE: 'Bestellungen' });
    expect(orders?.icon).toBe('shopping-cart');
    expect(orders?.displayColumn).toBe('order_number');
    expect(orders?.naturalKey).toEqual(['order_number']);
    expect(orders?.templates.map((t) => t.template)).toEqual(['page-queue-inbox', 'page-board']);
    expect(orders?.microcopy?.pageSubtitle.en_US).toBe('Track and fulfil customer orders');
  });

  it('keeps optional column descriptions and PII, defaulting pii to null', () => {
    const orders = set.tables['public.orders'];
    expect(orders?.columns['total_cents']?.description?.en_US).toBe(
      'Order total in cents; divide by 100 for display currency.',
    );
    expect(orders?.columns['order_number']?.pii).toBeNull();
    expect(set.tables['public.customers']?.columns['email']?.pii?.kind).toBe('email');
  });

  it('keys enums by "schema.table.column" and lifts inferred relations, groups, dashboards', () => {
    expect(set.enums['public.orders.status']?.kind).toBe('workflow');
    expect(set.inferredRelations).toHaveLength(1);
    expect(set.inferredRelations[0]?.fromColumns).toEqual(['product_id']);
    expect(set.navGroups.map((g) => g.id)).toEqual(['sales', 'catalog']);
    expect(set.dashboards.map((d) => d.id)).toEqual(['revenue']);
  });

  it('prefers an explicit run id override', () => {
    expect(normalizeLlmResponse(response, { llmRunId: 'run-x' }).llmRunId).toBe('run-x');
  });

  it('leaves suppressedRelations empty when every confirmed relation is correct:true', () => {
    // The demo response confirms one relation with correct:true — nothing suppressed.
    expect(set.suppressedRelations).toEqual([]);
  });

  it('lifts confirmed relations with correct:false into suppressedRelations (finding 8)', () => {
    const rejecting = LlmResponseV1.parse({
      schema_version: 'adminium.llm/v1',
      relations: {
        confirmed: [
          {
            fromTable: 'public.orders',
            fromColumns: ['customer_id'],
            toTable: 'public.customers',
            toColumns: ['id'],
            semantics: 'not actually related',
            correct: false,
            confidence: 0.8,
          },
          {
            fromTable: 'public.orders',
            fromColumns: ['product_id'],
            toTable: 'public.products',
            toColumns: ['id'],
            semantics: 'orders reference products',
            correct: true,
            confidence: 0.9,
          },
        ],
        inferred: [],
      },
    });
    const rejectingSet = normalizeLlmResponse(rejecting);
    expect(rejectingSet.suppressedRelations).toHaveLength(1);
    expect(rejectingSet.suppressedRelations[0]?.fromColumns).toEqual(['customer_id']);
    expect(rejectingSet.suppressedRelations[0]?.correct).toBe(false);
  });
});

describe('normalizeHeuristicBaseline', () => {
  const set = normalizeHeuristicBaseline(model, classified);

  it('tags the source and never carries an llm run id', () => {
    expect(set.source).toBe('heuristic');
    expect(set.llmRunId).toBeUndefined();
  });

  it('humanizes labels, maps shape icons, and selects display/natural keys', () => {
    expect(set.tables['public.orders']?.label).toEqual({ en_US: 'Orders' });
    expect(set.tables['public.orders']?.icon).toBe('kanban-square');
    expect(set.tables['public.customers']?.icon).toBe('users');
    expect(set.tables['public.products']?.icon).toBe('package');
    expect(set.tables['public.customers']?.displayColumn).toBe('full_name');
    expect(set.tables['public.customers']?.naturalKey).toEqual(['email']);
    expect(set.tables['public.products']?.naturalKey).toEqual(['sku']);
  });

  it('humanizes every column, including surrogate keys the LLM omits', () => {
    const orders = set.tables['public.orders'];
    expect(Object.keys(orders?.columns ?? {})).toEqual([
      'id',
      'order_number',
      'customer_id',
      'product_id',
      'status',
      'total_cents',
      'placed_at',
    ]);
    expect(orders?.columns['order_number']?.label).toEqual({ en_US: 'Order Number' });
  });

  it('flags heuristic PII with mapped kind + masking; clears non-PII columns', () => {
    const customers = set.tables['public.customers'];
    expect(customers?.columns['email']?.pii).toMatchObject({ kind: 'email', masking: 'mask-email' });
    expect(customers?.columns['full_name']?.pii).toMatchObject({ kind: 'name', masking: 'mask-partial' });
    expect(customers?.columns['country']?.pii).toBeNull();
    expect(customers?.columns['id']?.pii).toBeNull();
  });

  it('derives the workflow enum with keyword tones from declared values', () => {
    const status = set.enums['public.orders.status'];
    expect(status?.kind).toBe('workflow');
    expect(status?.order).toEqual(['pending', 'paid', 'shipped', 'cancelled', 'refunded']);
    expect(status?.tones).toEqual({
      pending: 'warn',
      paid: 'pos',
      shipped: 'pos',
      cancelled: 'danger',
      refunded: 'muted',
    });
  });

  it('leaves group/dashboard/relation baselines empty for the demo', () => {
    expect(set.inferredRelations).toEqual([]);
    expect(set.navGroups).toEqual([]);
    expect(set.dashboards).toEqual([]);
  });

  it('is deterministic', () => {
    expect(normalizeHeuristicBaseline(model, classifyModel(model))).toEqual(set);
  });
});
