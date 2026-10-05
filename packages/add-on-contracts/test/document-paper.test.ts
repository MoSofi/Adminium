// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { DOCUMENT_LOCALE_IDS, DOCUMENT_PAPERS, documentKindSchema } from '../src/document-render.js';

describe('the paper a document kind is drawn for', () => {
  const kind = { id: 'gift-card', label: Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, 'Gift card'])), formats: ['pdf'], coverage: 'winansi' };

  it('a kind may be drawn on a6, a card', () => {
    expect(DOCUMENT_PAPERS).toEqual(['a4', 'letter', 'a6', 'receipt-80mm']);
    expect(documentKindSchema.safeParse({ ...kind, paper: ['a6'] }).success).toBe(true);
    expect(documentKindSchema.safeParse({ ...kind, paper: ['a6', 'a4'] }).success).toBe(true);
  });

  it('a paper nobody listed is refused', () => {
    expect(documentKindSchema.safeParse({ ...kind, paper: ['a5'] }).success).toBe(false);
  });
});
