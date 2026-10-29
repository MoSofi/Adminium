// SPDX-License-Identifier: AGPL-3.0-only
/** The words a made picture starts from: plain code, short, and no person's name. */
import { describe, expect, it } from 'vitest';

import { holdsPeople, pictureWords, PICTURE_WORDS_MAX } from '../src/designer/picture-words.js';

describe('the words filled in for a picture', () => {
  it('says what, where and how it looks, with a tail by shape', () => {
    expect(pictureWords({ subject: 'Lemon drizzle', table: 'Cakes', appName: 'Crumb & Co.', look: 'warm, cream and brown', shape: 'square' })).toBe(
      'Lemon drizzle (cake), for Crumb & Co., look: warm, cream and brown, photo, natural light, no text',
    );
    expect(pictureWords({ subject: 'A bakery window at dawn', appName: 'Crumb & Co.', shape: 'wide' })).toBe('A bakery window at dawn, for Crumb & Co., wide photo, natural light, no text');
    expect(pictureWords({ subject: 'Carrot cake', table: 'Cakes', shape: 'tall' })).toBe('Carrot cake, tall photo, natural light, no text');
  });

  it('never puts a row’s name in for a table of people', () => {
    const words = pictureWords({ subject: 'Anna Weber', table: 'Staff', shape: 'square', people: true });
    expect(words).not.toContain('Anna');
    expect(words).toContain('portrait');
    expect(holdsPeople([{ name: 'id' }, { name: 'email' }])).toBe(true);
    expect(holdsPeople([{ name: 'first_name' }])).toBe(true);
    expect(holdsPeople([{ name: 'contact', semantic: 'phone' }])).toBe(true);
    expect(holdsPeople([{ name: 'title' }, { name: 'price' }, { name: 'category' }])).toBe(false);
  });

  it('is cleaned and kept short', () => {
    const words = pictureWords({ subject: `cake\u202e\u0000 ${'very '.repeat(100)}`, shape: 'wide' });
    expect(words.includes('\u202e') || words.includes('\u0000')).toBe(false);
    expect([...words].length).toBeLessThanOrEqual(PICTURE_WORDS_MAX);
  });
});
