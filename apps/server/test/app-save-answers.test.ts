// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: the gates' answers carried out on the file.
 *
 * The gates skip a place once it is answered, so "clear" must blank it and
 * "leave out" must drop it before they run, or the answer would let the
 * value through unasked.
 */
import type { AppManifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { carryOutAnswers } from '../src/apps/save/answers.js';
import { placeOf, readContent, targetOf } from '../src/apps/save/gates/content.js';

const PLANTED = 'not-a-real-value-0123456789';

function manifest(): AppManifest {
  return {
    kind: 'app',
    key: 'shop',
    pages: [
      { ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 } },
      { ref: 'notes', template: 'page-dashboard', title: { key: 'n', fallback: 'Notes' }, nav: { group: 'records', icon: 'list', order: 2 }, envelope: { v: 1, kind: 'page', template: 'page-dashboard', config: { layout: { items: [{ config: { text: `key ${PLANTED}` } }] } } } },
    ],
    seeds: [{ table: 'orders', file: 'seeds/orders.json' }],
  } as unknown as AppManifest;
}

/** The target the gates give the leaf that holds `needle`. */
function targetHolding(m: AppManifest, files: Map<string, Uint8Array>, needle: string): string {
  const content = readContent(m, files);
  const leaf = content.leaves.find((one) => one.value.includes(needle));
  if (leaf === undefined) throw new Error(`no leaf holds ${needle}`);
  return targetOf(content.placeOf(leaf));
}

describe('save as app: answers carried out', () => {
  it('blanks a cleared place in the manifest and in a seed file, and nothing else', () => {
    const m = manifest();
    const files = new Map([['seeds/orders.json', new TextEncoder().encode(JSON.stringify([{ id: 1, note: PLANTED }, { id: 2, note: 'kept' }]))]]);
    const inPage = targetHolding(m, files, `key ${PLANTED}`);
    const rowTarget = (() => {
      const content = readContent(m, files);
      const leaf = content.leaves.find((one) => one.file === 'seeds/orders.json' && one.value === PLANTED)!;
      return targetOf(content.placeOf(leaf));
    })();

    const answered = carryOutAnswers(m, files, { clear: [inPage, rowTarget] });
    const text = JSON.stringify(answered.manifest) + new TextDecoder().decode(answered.files.get('seeds/orders.json'));
    expect(text).not.toContain(PLANTED);
    expect(text).toContain('kept');
    // The source is untouched: answers make a new file.
    expect(JSON.stringify(m)).toContain(PLANTED);
  });

  it('drops an entry answered "leave out"', () => {
    const m = manifest();
    const kind = placeOf(m, { file: null, parts: ['pages', 1] }).kind;
    const answered = carryOutAnswers(m, new Map(), { leaveOut: [`${kind}:notes`] });
    expect(answered.manifest.pages.map((page) => page.ref)).toEqual(['orders']);
  });
});
