// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture's address, for an `<img>`: built from the config the key serves
 * and the column's value, or null for anything that is not a picture Adminium
 * keeps — the page shows its own tile then.
 */
import { describe, expect, it } from 'vitest';

import { pictureUrl } from '../src/index.js';

const ID = 'file_01J9Z3K8M2N4P6Q8R0S2T4V6W8';
const config = { pictures: '/api/v1/public/pictures/pk_1', refs: { menu_items: { pictures: ['image'] }, events: {} } } as never;

describe('a picture address', () => {
  it('is built from a bare id or a content address from any origin', () => {
    expect(pictureUrl('https://x/', config, 'menu_items', 7, 'image', ID)).toBe(`https://x/api/v1/public/pictures/pk_1/menu_items/7/image/${ID}`);
    expect(pictureUrl('https://x', config, 'menu_items', '7', 'image', `https://old.example/api/v1/files/${ID}/content`)).toBe(`https://x/api/v1/public/pictures/pk_1/menu_items/7/image/${ID}`);
  });

  it('is null for a column no entry shows as a picture, a key that shows none, and a value that names no file of ours', () => {
    expect(pictureUrl('https://x', config, 'menu_items', 7, 'thumb', ID)).toBeNull();
    expect(pictureUrl('https://x', config, 'events', 7, 'image', ID)).toBeNull();
    expect(pictureUrl('https://x', { refs: { menu_items: { pictures: ['image'] } } } as never, 'menu_items', 7, 'image', ID)).toBeNull();
    for (const value of [null, '', 'https://cdn.example/dish.jpg', 'uploads/dish.jpg', 42]) expect(pictureUrl('https://x', config, 'menu_items', 7, 'image', value)).toBeNull();
  });
});
