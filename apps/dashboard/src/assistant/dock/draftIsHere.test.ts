// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { draftIsHere } from './AssistantDock.js';

const turn = (documentId: string | null, savedId: string | null) => ({ on: { documentId }, result: { saved: savedId === null ? null : { id: savedId } } });

describe('where a draft is at home', () => {
  it('is the document it was made on', () => {
    expect(draftIsHere(turn('rule_1', null), 'rule_1')).toBe(true);
    expect(draftIsHere(turn(null, null), null)).toBe(true);
    expect(draftIsHere(turn('rule_1', null), 'rule_2')).toBe(false);
  });

  it('is also the document it was saved as: a rule`s page opens the rule the save just made', () => {
    // Made with nothing open, saved as rule_9, and the page now shows rule_9: not "parked" on its own page.
    expect(draftIsHere(turn(null, 'rule_9'), 'rule_9')).toBe(true);
    // Some other rule is open: the draft is not that rule's.
    expect(draftIsHere(turn(null, 'rule_9'), 'rule_2')).toBe(false);
    // A change to rule_1 that was saved stays rule_1's.
    expect(draftIsHere(turn('rule_1', 'rule_1'), 'rule_2')).toBe(false);
  });
});
