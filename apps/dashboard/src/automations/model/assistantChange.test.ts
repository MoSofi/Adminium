// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { afterApply } from './assistantChange.js';

describe('what the assistant put into the open rule', () => {
  it('keeps the rule as saved, or the person\'s own unsaved draft, as the way back', () => {
    expect(afterApply(null, { ruleId: 'a', dirty: false, draft: null, added: ['n3'] })).toEqual({ ruleId: 'a', before: null, added: ['n3'] });
    expect(afterApply(null, { ruleId: 'a', dirty: true, draft: 'mine', added: ['n3'] })).toEqual({ ruleId: 'a', before: 'mine', added: ['n3'] });
  });

  it('a second change keeps the first one\'s way back, and every new step stays marked', () => {
    const first = afterApply(null, { ruleId: 'a', dirty: true, draft: 'mine', added: ['n3'] });
    // The draft is now the assistant's own: it is not what Undo returns to.
    expect(afterApply(first, { ruleId: 'a', dirty: true, draft: 'the first change', added: ['n4', 'n3'] })).toEqual({ ruleId: 'a', before: 'mine', added: ['n3', 'n4'] });
    // After a save or an undo (nothing unsaved), or on another rule, it starts again.
    expect(afterApply(first, { ruleId: 'a', dirty: false, draft: null, added: [] })).toEqual({ ruleId: 'a', before: null, added: [] });
    expect(afterApply(first, { ruleId: 'b', dirty: true, draft: 'other', added: [] })).toEqual({ ruleId: 'b', before: 'other', added: [] });
  });
});
