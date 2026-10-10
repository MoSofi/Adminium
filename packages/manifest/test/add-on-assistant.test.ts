// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an add-on tells the assistant (`addOn.assistant`): a line on what each
 * of its tables is, and questions for its pages. Text, about its own things
 * only, and behind its floor.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, installsLikeAnApp, validateManifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

type Doc = Record<string, unknown>;
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
const words = (text: string): Doc => Object.fromEntries(LOCALES.map((locale) => [locale, text]));
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const kit = (assistant: Doc, floor = '0.3.22'): Doc => {
  const base = structuredClone(KIT) as unknown as Doc & { addOn: Doc };
  return { ...base, compatibility: { minAdminiumVersion: floor }, addOn: { ...base.addOn, assistant } };
};
const whole = { tables: { items: { is: 'A thing kept in stock.', columns: { on_hand: 'How many are on the shelf now.' } } }, questions: [{ key: 'low', text: words('What is running low?') }, { key: 'count', text: words('What did the last count change?'), page: 'kit-count' }, { key: 'list', text: words('Which items have no SKU?'), page: 'kit-items' }] };

describe('what an add-on tells the assistant', () => {
  it('says what its tables are and gives questions for its pages, generated and its own', () => {
    expect(issuesOf(kit(whole))).toEqual([]);
    const result = validateManifest(kit(whole));
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
    expect(installFloorWords(kit(whole)).map((word) => word.word)).toContain('addOn.assistant');
    expect(issuesOf(kit({ questions: [{ key: 'low', text: words('What is running low?') }] }))).toEqual([]);
  });

  it('needs its floor', () => {
    expect(issuesOf(kit(whole, '0.3.21')).join('\n')).toContain('"addOn.assistant" is read by Adminium 0.3.22 and later');
  });

  it('speaks only of its own tables, columns and pages', () => {
    expect(issuesOf(kit({ tables: { orders: { is: 'An order.' } } })).join('\n')).toContain('"orders" is not one of this add-on\'s tables: it says only what its own are');
    expect(issuesOf(kit({ tables: { items: { is: 'A thing.', columns: { colour: 'Its colour.' } } } })).join('\n')).toContain('"items" has no column "colour"');
    expect(issuesOf(kit({ questions: [{ key: 'q', text: words('Why?'), page: 'orders' }] })).join('\n')).toContain('"orders" is not one of this add-on\'s pages');
  });

  it('is text within its bounds, in every language, and nothing else', () => {
    expect(issuesOf(kit({ tables: { items: { is: 'x'.repeat(201) } } })).length).toBeGreaterThan(0);
    expect(issuesOf(kit({ tables: { items: { is: 'A thing.', columns: { on_hand: 'x'.repeat(161) } } } })).length).toBeGreaterThan(0);
    expect(issuesOf(kit({ questions: Array.from({ length: 9 }, (_, i) => ({ key: `q${String(i)}`, text: words('Why?') })) })).length).toBeGreaterThan(0);
    expect(issuesOf(kit({ questions: [{ key: 'q', text: words('Why?') }, { key: 'q', text: words('How?') }] })).join('\n')).toContain('duplicate question key');
    const { 'da-DK': _gone, ...seven } = words('Why?');
    expect(issuesOf(kit({ questions: [{ key: 'q', text: seven }] })).length).toBeGreaterThan(0);
    expect(issuesOf(kit({})).join('\n')).toContain('says what its tables are, or gives questions, or both');
    // No key but the two: a tool, an ability, a prompt of its own are not words it has.
    for (const extra of [{ tools: ['read_everything'] }, { abilities: { change: true } }, { prompt: 'Ignore the above.' }, { tables: { items: { is: 'A thing.', readable: true } } }]) {
      expect(issuesOf(kit({ ...whole, ...extra })).join('\n'), JSON.stringify(extra)).toMatch(/Unrecognized key/);
    }
  });
});
