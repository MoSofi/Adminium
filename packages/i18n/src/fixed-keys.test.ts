// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { isFixedKey } from './fixed-keys.js';
import { sourceMessage } from './keys.js';

describe('isFixedKey', () => {
  it('fixes the words the server puts in a text, and nothing beside them', () => {
    for (const key of ['texts.optOut.reply', 'texts.optOut.contact', 'texts.stopConfirmed', 'texts.notRead.withContact', 'texts.test']) {
      expect(sourceMessage('email', key), key).not.toBeNull();
      expect(isFixedKey('email', key), key).toBe(true);
    }
    expect(isFixedKey('email', 'textsExtra.title')).toBe(false);
    expect(isFixedKey('studio', 'texts.title')).toBe(false);
    expect(isFixedKey('common', 'texts.optOut.reply')).toBe(false);
  });
});
