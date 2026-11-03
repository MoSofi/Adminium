// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A product asset's addresses, for a 3D viewer's fetch or a font load: built
 * from the config the key serves and the column's value (one file, or a list
 * of pieces), empty for anything that is not an asset Adminium keeps.
 */
import { describe, expect, it } from 'vitest';

import { assetUrls } from '../src/index.js';

const A = 'file_01J9Z3K8M2N4P6Q8R0S2T4V6W8';
const B = 'file_01J9Z3K8M2N4P6Q8R0S2T4V6W9';
const config = { assets: '/api/v1/public/assets/pk_1', refs: { products: { assets: ['preview', 'pieces'] }, events: {} } } as never;

describe('an asset address', () => {
  it('is built for one file, and for each file of a list, in order', () => {
    expect(assetUrls('https://x/', config, 'products', 7, 'preview', A)).toEqual([`https://x/api/v1/public/assets/pk_1/products/7/preview/${A}`]);
    expect(assetUrls('https://x', config, 'products', '7', 'pieces', [A, B])).toEqual([
      `https://x/api/v1/public/assets/pk_1/products/7/pieces/${A}`,
      `https://x/api/v1/public/assets/pk_1/products/7/pieces/${B}`,
    ]);
    // A list as text, as some databases hand it back.
    expect(assetUrls('https://x', config, 'products', 7, 'pieces', JSON.stringify([B]))).toEqual([`https://x/api/v1/public/assets/pk_1/products/7/pieces/${B}`]);
  });

  it('is empty for a column no entry serves as assets, a key that serves none, and a value that names no file of ours', () => {
    expect(assetUrls('https://x', config, 'products', 7, 'notes', A)).toEqual([]);
    expect(assetUrls('https://x', config, 'events', 7, 'preview', A)).toEqual([]);
    expect(assetUrls('https://x', { refs: { products: { assets: ['preview'] } } } as never, 'products', 7, 'preview', A)).toEqual([]);
    for (const value of [null, '', 'https://cdn.example/model.glb', 42, '[broken']) expect(assetUrls('https://x', config, 'products', 7, 'preview', value)).toEqual([]);
  });
});
