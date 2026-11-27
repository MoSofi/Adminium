// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A public entry that lets a browser write a row's key is refused when its
 * endpoint is made ("is the primary key and cannot be writable"), which is
 * part way through an apply: the app keeps running as it was, its new pages
 * and access unwritten. The check passed it, so the mistake showed only then.
 * It is said of the entry while the app is being built.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest, validateStoredManifest } from '../src/index.js';
import { entryOf, issuesText, kitchen, tableOf, type Doc } from './orders-stays-fixture.js';

const issues = (m: Doc): string[] => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const keyOf = (m: Doc, table: string): string => ((tableOf(m, table)['columns'] as Doc[]).find((column) => column['role'] === 'pk')?.['ref'] as string | undefined) ?? 'id';

describe('a row\'s key among what a browser may write', () => {
  it('is refused on an entry that sends values, with the column and the table named', () => {
    const m = kitchen();
    expect(issues(m), issuesText(m)).toEqual([]);
    const create = entryOf(m, 'orders', 'POST');
    const key = keyOf(m, 'orders');
    const at = `publicAccess.${String((m['publicAccess'] as Doc[]).indexOf(create))}.writable`;
    create['writable'] = [...(create['writable'] as string[]), key];
    expect(issues(m)).toContain(`${at}: "${key}" is the key of "orders" and cannot be written publicly: the database gives a row its key`);
  });

  it('is not said of an entry that only reads, whatever it lists', () => {
    const m = kitchen();
    const read = (m['publicAccess'] as Doc[]).find((entry) => (entry['methods'] as string[]).every((method) => method === 'GET') && entry['claim'] === undefined && entry['kind'] === undefined) as Doc;
    read['writable'] = [keyOf(m, read['table'] as string)];
    expect(issues(m).filter((line) => line.includes('is the key of'))).toEqual([]);
  });

  it('does not take a stored app away from what reads it: a document held from before is read without the entry', () => {
    // Stored by an older Adminium, which passed both shapes; no endpoint was ever made for either entry.
    const m = kitchen();
    const entries = m['publicAccess'] as Doc[];
    const create = entryOf(m, 'orders', 'POST');
    create['writable'] = [...(create['writable'] as string[]), keyOf(m, 'orders')];
    expect(validateManifest(m).ok).toBe(false);
    const read = validateStoredManifest(m);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.manifest.publicAccess).toHaveLength(entries.length - 1);
    expect(read.manifest.publicAccess?.some((entry) => entry.table === 'orders' && entry.methods.includes('POST'))).toBe(false);
    // A sound document reads as itself, and anything else a document fails on is still said.
    expect(validateStoredManifest(kitchen())).toEqual(validateManifest(kitchen()));
    const broken = kitchen();
    (entryOf(broken, 'orders', 'POST')['writable'] as string[]).push(keyOf(broken, 'orders'), 'no_such_column');
    const still = validateStoredManifest(broken);
    expect(still.ok).toBe(false);
    expect(still).toEqual(validateManifest(broken));
  });
});
