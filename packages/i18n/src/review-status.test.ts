// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Gate on the translation review-status data (10-i18n-theming.md §3.1/§3.3).
 *
 * The parity test next door proves every locale has every KEY. This one proves
 * we know what those translations are WORTH: that each is tracked, that its
 * status is a real status, and that the runtime's `REVIEW_STATUS` — which the
 * locale picker uses to label a language "(community draft)" — actually matches
 * the tracked data rather than a stale hand-edit.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOCALES, type BuiltinLocaleId } from './locales.js';
import { REVIEW_STATUS, isReviewed, reviewedFraction } from './review-status.js';

const ROOT = path.join(__dirname, '..');
const NAMESPACES = ['common', 'ui', 'studio', 'generated', 'errors'] as const;
const TARGETS = LOCALES.filter((l) => l.id !== 'en_US');

const hash = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 12);

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

const bundle = (tag: string, ns: string): Record<string, string> =>
  flatten(JSON.parse(readFileSync(path.join(ROOT, 'locales', tag, `${ns}.json`), 'utf8')));

const source = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const ns of NAMESPACES) for (const [k, v] of Object.entries(bundle('en-US', ns))) out[`${ns}.${k}`] = v;
  return out;
};

interface MetaEntry {
  status: 'mt' | 'reviewed';
  srcHash: string;
}

const meta = (tag: string): Record<string, MetaEntry> =>
  JSON.parse(readFileSync(path.join(ROOT, 'locales', tag, '.meta.json'), 'utf8'));

describe('translation review status', () => {
  const src = source();

  it.each(TARGETS.map((l) => l.tag))('%s tracks exactly the en-US key set', (tag) => {
    const m = meta(tag);
    const tracked = new Set(Object.keys(m));
    const expected = new Set(Object.keys(src));
    // Untracked keys are the dangerous direction: a string nobody knows is
    // unreviewed reads as though it were finished.
    expect([...expected].filter((k) => !tracked.has(k))).toEqual([]);
    expect([...tracked].filter((k) => !expected.has(k))).toEqual([]);
  });

  it.each(TARGETS.map((l) => l.tag))('%s stores only real statuses and hashes', (tag) => {
    for (const [key, entry] of Object.entries(meta(tag))) {
      expect(['mt', 'reviewed'], `${tag}:${key}`).toContain(entry.status);
      // `outdated` is DERIVED (srcHash vs the live English), never stored —
      // storing it loses what the translator actually read.
      expect(entry.srcHash, `${tag}:${key}`).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it.each(TARGETS.map((l) => l.tag))('%s: REVIEW_STATUS matches the tracked file', (tag) => {
    const m = meta(tag);
    const id = LOCALES.find((l) => l.tag === tag)!.id as Exclude<BuiltinLocaleId, 'en_US'>;
    let reviewed = 0;
    let outdated = 0;
    for (const [key, entry] of Object.entries(m)) {
      const stale = src[key] !== undefined && entry.srcHash !== hash(src[key]);
      if (stale) outdated += 1;
      else if (entry.status === 'reviewed') reviewed += 1;
    }
    const runtime = REVIEW_STATUS[id];
    expect(runtime.tracked).toBe(Object.keys(m).length);
    expect(runtime.reviewed).toBe(reviewed);
    expect(runtime.outdated).toBe(outdated);
    expect(runtime.mt).toBe(runtime.tracked - reviewed - outdated);
  });

  it('never claims an unreviewed locale is ship-ready', () => {
    for (const l of TARGETS) {
      const s = REVIEW_STATUS[l.id as Exclude<BuiltinLocaleId, 'en_US'>];
      if (s.reviewed < s.tracked) expect(s.shipReady, `${l.tag}`).toBe(false);
      expect(isReviewed(l.id)).toBe(s.shipReady);
    }
  });

  it('treats en-US as the source, not a translation', () => {
    expect(isReviewed('en_US')).toBe(true);
    expect(reviewedFraction('en_US')).toBe(1);
    expect(REVIEW_STATUS).not.toHaveProperty('en_US');
  });

  it('reports the honest current state: everything is machine-drafted', () => {
    // This is the fact the ship gate turns on. If a future change makes it
    // false, that is good news — update the assertion deliberately.
    for (const l of TARGETS) {
      expect(reviewedFraction(l.id), `${l.tag}`).toBe(0);
      expect(isReviewed(l.id), `${l.tag}`).toBe(false);
    }
  });
});
