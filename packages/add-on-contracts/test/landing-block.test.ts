// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addOn.landing`: the add-on block names a landing pages add-on's pages and
 * funnels tables. Only the refs are typed here; the manifest package checks
 * the tables themselves.
 */
import { describe, expect, it } from 'vitest';

import { addOnBlockSchema } from '../src/index.js';

const BLOCK = { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } };
const LANDING = { pages: 'pages', funnels: 'funnels' };

describe('an add-on block that declares landing pages', () => {
  it('takes the two table refs', () => {
    const result = addOnBlockSchema.safeParse({ ...BLOCK, landing: LANDING });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data?.landing).toEqual(LANDING);
  });

  it('is absent from a block that declares none, and is not the staff pages word', () => {
    expect(addOnBlockSchema.parse(BLOCK).landing).toBeUndefined();
  });

  it('refuses a missing part or a ref that is not a table ref', () => {
    expect(addOnBlockSchema.safeParse({ ...BLOCK, landing: { pages: 'pages' } }).success).toBe(false);
    expect(addOnBlockSchema.safeParse({ ...BLOCK, landing: { ...LANDING, funnels: 'Funnels' } }).success).toBe(false);
  });

  it('keeps any other word for the manifest package to judge', () => {
    expect(addOnBlockSchema.safeParse({ ...BLOCK, landing: { ...LANDING, extra: 'x' } }).success).toBe(true);
  });
});
