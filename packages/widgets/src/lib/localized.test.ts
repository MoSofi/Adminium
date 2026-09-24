// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { pickLocalized } from './localized.js';

describe('a string in the reader’s language', () => {
  const titles = { 'de-DE': 'Heute', 'pt-BR': 'Hoje', zh: '今天', 'fr-CA': '' };
  it('takes the exact tag, then the language in another region, then the string itself', () => {
    expect(pickLocalized('Today', titles, 'de_DE')).toBe('Heute');
    expect(pickLocalized('Today', titles, 'de-AT')).toBe('Heute');
    expect(pickLocalized('Today', titles, 'pt_PT')).toBe('Hoje');
    expect(pickLocalized('Today', titles, 'zh_TW')).toBe('今天');
    // An empty translation is no translation.
    expect(pickLocalized('Today', titles, 'fr_CA')).toBe('Today');
    expect(pickLocalized('Today', titles, 'da_DK')).toBe('Today');
    expect(pickLocalized('Today', undefined, 'de_DE')).toBe('Today');
    expect(pickLocalized('Today', titles, undefined)).toBe('Today');
    expect(pickLocalized(undefined, {}, 'de_DE')).toBeUndefined();
  });
});
