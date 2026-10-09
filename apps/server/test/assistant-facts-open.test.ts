// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page's facts are an open list on the wire.
 *
 * When the reply named each count, a page that measured a new one had to be
 * added in three places, and the one that was missed dropped the fact: the
 * header then drew its sentence's raw placeholder. The reply's schema is what
 * dropped it, so that is what is tested.
 */
import { describe, expect, it } from 'vitest';

import { assistantFactsView } from '../src/routes/assistant/schema.js';

const scope = { primary: 'orders', extra: 3 };

describe('the facts a page reports', () => {
  it('carries a fact no list ever named', () => {
    const facts = { values: { rows: 214, table: 'orders', filtered: true, rules: 2 }, scope };
    expect(assistantFactsView.parse(facts)).toEqual(facts);
  });

  it('holds numbers, names and yes/no answers, never a document', () => {
    expect(assistantFactsView.safeParse({ values: { note: 'x'.repeat(201) }, scope }).success).toBe(false);
    expect(assistantFactsView.safeParse({ values: { rows: { nested: 1 } }, scope }).success).toBe(false);
    expect(assistantFactsView.safeParse({ values: { rows: [1, 2] }, scope }).success).toBe(false);
  });

  it('keeps a key something a translated sentence can name, and the list short', () => {
    expect(assistantFactsView.safeParse({ values: { 'not a key': 1 }, scope }).success).toBe(false);
    expect(assistantFactsView.safeParse({ values: { Rows: 1 }, scope }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`fact${String(index)}`, index]));
    expect(assistantFactsView.safeParse({ values: many, scope }).success).toBe(false);
    expect(assistantFactsView.safeParse({ values: Object.fromEntries(Object.entries(many).slice(0, 24)), scope }).success).toBe(true);
  });
});
