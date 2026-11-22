// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How long "What stays" says a thing is kept. A notification's clock starts
 * when it is read, and an unread one is never swept, so a plain "Kept for 90
 * days" would be untrue for it.
 */
import { describe, expect, it } from 'vitest';

import type { StaysItem } from './privacyApi.js';
import { staysWords } from './privacyWords.js';

const notifications: StaysItem = { kind: 'notifications', reason: 'kept-a-while', count: 3, keptDays: 90, forever: false };

describe('how long a stay is kept', () => {
  it('says a notification is kept until it is read, then for the set days', () => {
    expect(staysWords(notifications)).toEqual({
      line: '3 notifications to staff.',
      kept: 'Kept until read, then for 90 days.',
    });
    expect(staysWords({ ...notifications, keptDays: 1 }).kept).toBe('Kept until read, then for 1 day.');
  });

  it('keeps the plain wording for a store whose clock does not wait to be read', () => {
    expect(staysWords({ kind: 'exports', reason: 'kept-a-while', count: null, keptDays: 30, forever: false }).kept).toBe('Kept for 30 days.');
  });
});
