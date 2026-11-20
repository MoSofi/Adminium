// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A condition an app's rule writes that asks an add-on's words ("is the
 * variant this request names back in stock?"): the builder shows it as a
 * sentence and never offers to change it, and it counts as complete.
 */
import { describe, expect, it } from 'vitest';

import type { SourceTable } from '../api.js';
import type { Condition, FlowNode } from './graph.js';
import { subLineFor, wordsSentence } from './summaries.js';
import { isConditionComplete } from './validate.js';

const requests = { columns: [{ name: 'variant_id', label: 'Variant' }] } as unknown as SourceTable;
const back: Condition = { left: { words: 'inventory:stock', of: 'variant_id' }, op: 'is', right: 'in' };

describe("an add-on's words in a rule's condition", () => {
  it('reads as the link, the add-on and the state', () => {
    expect(wordsSentence(back, requests)).toBe('Variant: inventory says in stock');
    expect(wordsSentence({ ...back, op: 'is_not', right: 'out' }, requests)).toBe('Variant: inventory does not say out of stock');
    expect(wordsSentence({ ...back, right: 'low' }, null)).toBe('variant_id: inventory says low');
    const node = { id: 'n2', kind: 'condition', title: 'Only if back', onError: false, condition: back } as unknown as FlowNode;
    expect(subLineFor(node, requests)).toBe('Variant: inventory says in stock');
  });

  it('is complete once it names its link', () => {
    expect(isConditionComplete(back)).toBe(true);
    expect(isConditionComplete({ ...back, left: { words: 'inventory:stock', of: '' } })).toBe(false);
  });
});
