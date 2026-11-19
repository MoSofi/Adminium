// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record action Adminium's own record page shows: a `record.actions` fill
 * that names the kind of declared table it acts on (`on: "companies"`), with
 * the button's words and icon. The three go together, and only on that slot;
 * a fill without them is for apps' own screens, as every fill was. The word
 * needs the release that reads it. And a source's name in the add-on's own
 * words, for the notes under the fields it filled.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';
import { leadFinder } from './lead-finder-fixture.js';

type Doc = Record<string, unknown>;

const ACTION: Doc = {
  slot: 'record.actions',
  client: 'dist/client.js',
  order: 10,
  on: 'companies',
  label: { key: 'company-finder.fill', fallback: 'Fill in details' },
  labels: { 'de-DE': 'Details ausfüllen', 'ar-EG': 'املأ التفاصيل' },
  icon: 'scan-search',
};

const withFill = (fill: Doc): Doc => {
  const doc = leadFinder();
  (doc['addOn'] as Doc)['slots'] = [fill];
  return doc;
};
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a record action the record page shows', () => {
  it('validates with the kind of table, its words and its icon, and needs the release that reads it', () => {
    const doc = withFill(ACTION);
    expect(issuesOf(doc)).toEqual([]);
    expect(installFloorWords(doc).filter((word) => word.word === 'addOn.slots.on')).toEqual([{ word: 'addOn.slots.on', path: 'addOn.slots.0.on' }]);
    expect(WORD_FLOORS['addOn.slots.on']).toBe(WORD_FLOORS['addOn.sources']);
  });

  it('a fill for apps\' own screens names none of them, and needs no new release', () => {
    const doc = withFill({ slot: 'record.actions', client: 'dist/client.js', order: 10 });
    expect(issuesOf(doc)).toEqual([]);
    expect(installFloorWords(doc).some((word) => word.word === 'addOn.slots.on')).toBe(false);
  });

  it('refuses the kind of table on another slot, a kind there is not, and words or an icon with no kind', () => {
    expect(issuesOf(withFill({ ...ACTION, slot: 'order.line.actions' })).join('\n')).toContain('"on" is for a record.actions fill only');
    expect(issuesOf(withFill({ ...ACTION, on: 'people' })).length).toBeGreaterThan(0);
    const { on: _on, ...noKind } = ACTION;
    expect(issuesOf(withFill(noKind)).join('\n')).toContain('name the kind of table it acts on');
    expect(issuesOf(withFill({ slot: 'record.actions', client: 'dist/client.js', order: 10, icon: 'scan-search' })).join('\n')).toContain('name the kind of table it acts on');
  });

  it('refuses a kind of table with no words, or no icon, or an icon that is not a name', () => {
    const { label: _label, ...noLabel } = ACTION;
    expect(issuesOf(withFill(noLabel)).join('\n')).toContain('needs its words ("label")');
    const { icon: _icon, ...noIcon } = ACTION;
    expect(issuesOf(withFill(noIcon)).join('\n')).toContain('needs an icon');
    expect(issuesOf(withFill({ ...ACTION, icon: '<svg/>' })).join('\n')).toContain('kebab-case Lucide name');
  });
});

describe('a source named in the add-on\'s own words', () => {
  it('takes a label and its other languages, and nothing else new', () => {
    const doc = leadFinder();
    const sources = (doc['addOn'] as Doc)['sources'] as Doc[];
    sources[0]!['label'] = { key: 'company-finder.sources.companies-house', fallback: 'Companies House' };
    sources[0]!['labels'] = { 'fr-FR': 'Companies House (Royaume-Uni)' };
    expect(issuesOf(doc)).toEqual([]);
    sources[0]!['name'] = 'Companies House';
    expect(issuesOf(doc).length).toBeGreaterThan(0);
  });
});
