// SPDX-License-Identifier: AGPL-3.0-only
/** `frontends[].embed`: which screens of a customer side a listed website may frame. */
import { describe, expect, it } from 'vitest';

import { embedOfDocument, frontendEmbedSchema, installFloorWords, isEmbedPath } from '../src/index.js';
import { embedIssues } from '../src/embed.js';
import { withoutModules } from '../src/modules.js';

const tables = [
  {
    ref: 'services',
    columns: [{ ref: 'slug' }, { ref: 'name' }, { ref: 'meta', type: 'json' }, { ref: 'photo', type: 'blob' }, { ref: 'secret', hidden: true }, { ref: 'token', rules: { code: { length: 16, hiddenFromStaff: true } } }],
  },
  { ref: 'diary', private: true as const, columns: [{ ref: 'slug' }, { ref: 'name' }] },
];

const customer = (embed: unknown) => ({ frontends: [{ side: 'customer', kind: 'spa', embed }], requiredSchema: { tables } });

describe('the path grammar', () => {
  it('takes a plain path after the mount', () => {
    for (const path of ['/', '/book', '/reviews', '/a/b-c_d.e~f']) expect(isEmbedPath(path)).toBe(true);
  });

  it('refuses anything that could read differently or leave the mount', () => {
    for (const path of ['', 'book', '//evil', '/a//b', '/.', '/..', '/a/../b', '/a/./b', '/book/', '/book?x=1', '/b%6Fok', '/a b', '/a\\b', `/${'x'.repeat(120)}`]) {
      expect(isEmbedPath(path), path).toBe(false);
    }
  });
});

describe('the word', () => {
  it('takes paths, with words and a choice, and the three ways', () => {
    const parsed = frontendEmbedSchema.safeParse({
      paths: ['/', { path: '/book', label: 'Book a service', choose: { query: 'service', table: 'services', value: 'slug', label: 'name', title: 'A particular service', any: 'Any service' } }],
      modes: ['inline', 'button', 'floating'],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses an unknown key, a path twice, a way twice, a way it does not know, and no paths', () => {
    for (const bad of [
      { paths: ['/'], extra: 1 },
      { paths: ['/book', { path: '/book' }] },
      { paths: ['/'], modes: ['inline', 'inline'] },
      { paths: ['/'], modes: ['popup'] },
      { paths: [] },
      { paths: ['/b?x=1'] },
      { paths: [{ path: '/b', choose: { query: 'Bad Query', table: 'services', value: 'slug', label: 'name' } }] },
    ]) {
      expect(frontendEmbedSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a choice named after what the loader writes on the address', () => {
    for (const query of ['frame', 'mode', 'lang', 'theme']) {
      expect(frontendEmbedSchema.safeParse({ paths: [{ path: '/b', choose: { query, table: 'services', value: 'slug', label: 'name' } }] }).success, query).toBe(false);
    }
  });

  it('needs the release that knows it', () => {
    const floors = installFloorWords({ frontends: [{ side: 'customer', kind: 'spa', embed: { paths: ['/'] } }] });
    expect(floors.some((word) => word.word === 'frontend.embed')).toBe(true);
  });
});

describe('what a manifest may declare', () => {
  const choose = (over: Record<string, string>) => ({ paths: [{ path: '/book', choose: { query: 'service', table: 'services', value: 'slug', label: 'name', ...over } }] });

  it('only on a customer side', () => {
    const issues = embedIssues({ frontends: [{ side: 'staff', kind: 'spa', embed: { paths: ['/'] } }], requiredSchema: { tables } });
    expect(issues.map((one) => one.message)).toEqual(['only a customer side may be shown on a website']);
  });

  it('passes a side with none, and a plain list', () => {
    expect(embedIssues({ frontends: [{ side: 'customer', kind: 'spa' }], requiredSchema: { tables } })).toEqual([]);
    expect(embedIssues(customer({ paths: ['/', '/book'] }))).toEqual([]);
    expect(embedIssues(customer(choose({})))).toEqual([]);
  });

  it('a choice reads an open table of the app, and shown columns only', () => {
    expect(embedIssues(customer(choose({ table: 'nope' })))[0]!.message).toContain('"nope"');
    expect(embedIssues(customer(choose({ table: 'diary' })))[0]!.message).toContain('"diary"');
    expect(embedIssues(customer(choose({ value: 'missing' })))[0]!.path.at(-1)).toBe('value');
    expect(embedIssues(customer(choose({ label: 'secret' })))[0]!.path.at(-1)).toBe('label');
    expect(embedIssues(customer(choose({ value: 'token' })))[0]!.path.at(-1)).toBe('value');
    // A cell every engine reads alike: a JSON column is an object on two of them and text on the third.
    expect(embedIssues(customer(choose({ label: 'meta' })))[0]!.path.at(-1)).toBe('label');
    expect(embedIssues(customer(choose({ label: 'photo' })))[0]!.path.at(-1)).toBe('label');
  });
});

describe('an app with a part left out', () => {
  const app = (choose: Record<string, string>) => ({
    requiredSchema: {
      tables: [
        { ref: 'services', module: 'extras', columns: [{ ref: 'slug', type: 'text' }] },
        { ref: 'rooms', columns: [{ ref: 'slug', type: 'text' }, { ref: 'owner', type: 'fk', references: 'services' }] },
      ],
    },
    frontends: [{ side: 'customer', kind: 'spa', embed: { paths: ['/', { path: '/book', choose: { query: 'pick', value: 'slug', label: 'slug', ...choose } }] } }],
  });
  const screens = (document: ReturnType<typeof app>) => withoutModules(document, ['extras']).frontends[0]!.embed.paths;

  it('keeps the screen and drops a choice read from a table that is not made', () => {
    expect(screens(app({ table: 'services' }))).toEqual(['/', { path: '/book' }]);
  });

  it('drops a choice read from a link column that goes with it', () => {
    expect(screens(app({ table: 'rooms', label: 'owner' }))).toEqual(['/', { path: '/book' }]);
    expect(screens(app({ table: 'rooms', value: 'owner' }))).toEqual(['/', { path: '/book' }]);
  });

  it('keeps a choice that stays whole', () => {
    expect(screens(app({ table: 'rooms' }))[1]).toMatchObject({ choose: { table: 'rooms' } });
  });
});

describe('reading a stored manifest', () => {
  it('answers null for anything that declares nothing or does not parse', () => {
    for (const stored of [null, 'x', {}, { frontends: 'x' }, { frontends: [null] }, { frontends: [{ side: 'staff', embed: { paths: ['/'] } }] }, { frontends: [{ side: 'customer' }] }, { frontends: [{ side: 'customer', embed: { paths: ['nope'] } }] }]) {
      expect(embedOfDocument(stored)).toBeNull();
    }
  });

  it('reads each screen the same way, and every way when none is named', () => {
    const read = embedOfDocument({
      frontends: [
        { side: 'staff' },
        { side: 'customer', embed: { paths: ['/', { path: '/reviews' }, { path: '/book', label: 'Book', choose: { query: 'service', table: 'services', value: 'slug', label: 'name' } }] } },
      ],
    });
    expect(read).toEqual({
      screens: [{ path: '/' }, { path: '/reviews' }, { path: '/book', label: 'Book', choose: { query: 'service', table: 'services', value: 'slug', label: 'name' } }],
      modes: ['inline', 'button', 'floating'],
    });
  });

  it('keeps the ways it names', () => {
    expect(embedOfDocument({ frontends: [{ side: 'customer', embed: { paths: ['/'], modes: ['button'] } }] })?.modes).toEqual(['button']);
  });
});
