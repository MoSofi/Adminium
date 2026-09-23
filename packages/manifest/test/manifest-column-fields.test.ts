// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The column `default` and `maxLength` fields, and a page's `titles`.
 *
 * Every default a manifest may declare has to mean the same thing on all
 * three engines, so `defaultIssue` refuses the ones that would not: a literal
 * timestamp, a text default MySQL's TEXT cannot hold, a default on a key.
 */
import { describe, expect, it } from 'vitest';

import { defaultIssue, MAX_TEXT_LENGTH, pageSchema, requiredColumnSchema } from '../src/index.js';

describe('defaultIssue', () => {
  it('accepts a default of each type, and `now` on a timestamptz', () => {
    expect(defaultIssue({ type: 'timestamptz', default: 'now' })).toBeNull();
    expect(defaultIssue({ type: 'text', maxLength: 10, default: 'hi' })).toBeNull();
    expect(defaultIssue({ type: 'enum', enum: ['a', 'b'], default: 'b' })).toBeNull();
    expect(defaultIssue({ type: 'int', default: 2 })).toBeNull();
    expect(defaultIssue({ type: 'bigint', default: 0 })).toBeNull();
    expect(defaultIssue({ type: 'decimal', default: 1.5 })).toBeNull();
    expect(defaultIssue({ type: 'money', default: 0 })).toBeNull();
    expect(defaultIssue({ type: 'float', default: 0.25 })).toBeNull();
    expect(defaultIssue({ type: 'bool', default: true })).toBeNull();
    expect(defaultIssue({ type: 'json' })).toBeNull();
  });

  it('names what is wrong with each default it refuses', () => {
    expect(defaultIssue({ type: 'int', role: 'pk', default: 1 })).toContain('primary key');
    expect(defaultIssue({ type: 'timestamptz', default: '2026-01-01' })).toContain('"now"');
    expect(defaultIssue({ type: 'text', default: 3 })).toContain('must be a string');
    expect(defaultIssue({ type: 'text', default: 'hi' })).toContain('needs maxLength');
    expect(defaultIssue({ type: 'text', maxLength: 1, default: 'hi' })).toContain('longer than maxLength');
    expect(defaultIssue({ type: 'enum', enum: ['a'], default: 'z' })).toContain('one of its values');
    expect(defaultIssue({ type: 'int', default: 1.5 })).toContain('whole number');
    expect(defaultIssue({ type: 'money', default: 'free' })).toContain('must be a number');
    expect(defaultIssue({ type: 'bool', default: 1 })).toContain('true or false');
    expect(defaultIssue({ type: 'json', default: '{}' })).toContain('takes no default');
    expect(defaultIssue({ type: 'date', default: 'now' })).toContain('takes no default');
  });
});

describe('the column schema', () => {
  it('reports a bad default under `default`', () => {
    const parsed = requiredColumnSchema.safeParse({ ref: 'a', type: 'int', default: 'x' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['default']);
  });

  it('keeps maxLength to text, up to the cap', () => {
    expect(requiredColumnSchema.safeParse({ ref: 'a', type: 'text', maxLength: MAX_TEXT_LENGTH }).success).toBe(true);
    expect(requiredColumnSchema.safeParse({ ref: 'a', type: 'text', maxLength: MAX_TEXT_LENGTH + 1 }).success).toBe(false);
    const onInt = requiredColumnSchema.safeParse({ ref: 'a', type: 'int', maxLength: 5 });
    expect(onInt.error?.issues[0]?.path).toEqual(['maxLength']);
  });
});

describe("a page's titles", () => {
  const page = { ref: 'menu', template: 'page-crud', title: { key: 'k', fallback: 'Menu' }, nav: { group: 'manage', icon: 'list', order: 1 } };
  it('are keyed by BCP 47 tag', () => {
    expect(pageSchema.safeParse({ ...page, titles: { 'de-DE': 'Speisekarte', fr: 'Carte' } }).success).toBe(true);
    expect(pageSchema.safeParse({ ...page, titles: { de_DE: 'Speisekarte' } }).success).toBe(false);
    expect(pageSchema.safeParse({ ...page, titles: { 'de-DE': '' } }).success).toBe(false);
  });
});
