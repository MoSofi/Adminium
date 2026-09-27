// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public side's later vocabulary, each rule broken once on a manifest
 * that otherwise validates and read back as the sentence it gives.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { entryOf, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

const create = (m: Doc) => entryOf(m, 'orders', 'POST');

describe("an entry's own hour per visitor", () => {
  it('validates at or below the 60 every visitor is held to, and is kept', () => {
    const m = kitchen();
    (create(m)['anonymous'] as Doc)['perIpHour'] = 10;
    expect(messages(m)).toEqual([]);
    const result = validateManifest(m);
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('invalid');
    expect(result.manifest.publicAccess!.find((e) => e.methods.includes('POST') && e.table === 'orders')!.anonymous?.perIpHour).toBe(10);
  });

  it('is never more than 60, nor less than one', () => {
    for (const n of [61, 0, 2.5]) {
      const m = kitchen();
      (create(m)['anonymous'] as Doc)['perIpHour'] = n;
      expect(issuesText(m), String(n)).toContain('perIpHour');
    }
  });
});
