// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Landing pages in a manifest: an add-on's `landing` word, which names its
 * tables for the pages and the funnels, each holding the columns the engine
 * reads. Each refusal is one broken thing of a fixture that validates.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, installsLikeAnApp, LANDING_COLUMNS, LANDING_PARTS, landingOf, validateManifest, WORD_FLOORS } from '../src/index.js';
import { chatAddOn } from './chat-fixture.js';
import { landingAddOn } from './landing-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const tableOf = (doc: Doc, ref: string) => ((doc['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === ref) as Doc & { columns: Doc[] });
const columnOf = (doc: Doc, table: string, ref: string) => tableOf(doc, table).columns.find((column) => column['ref'] === ref)!;
const block = (doc: Doc) => (doc['addOn'] as Doc)['landing'] as Doc;
const changed = (edit: (doc: Doc) => void): Doc => {
  const doc = landingAddOn();
  edit(doc);
  return doc;
};
const one = (edit: (d: Doc) => void) => issuesOf(changed(edit)).join('\n');

describe('an add-on\'s landing pages', () => {
  it('names its two tables, each with the columns the engine reads: it validates and installs like an app', () => {
    const doc = landingAddOn();
    expect(issuesOf(doc)).toEqual([]);
    const result = validateManifest(doc);
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
    expect(result.ok && landingOf(result.manifest)).toEqual({ pages: 'pages', funnels: 'funnels' });
  });

  it('installs like an app on its landing word alone', () => {
    const bare = changed((d) => {
      delete d['roles'];
      delete (d['requiredSchema'] as Doc)['prefixed'];
    });
    const result = validateManifest(bare);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(true);
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
  });

  it('is not the staff pages word, and an app or an add-on without it has none', () => {
    const result = validateManifest(chatAddOn());
    expect(result.ok && landingOf(result.manifest)).toBeNull();
  });

  it('needs its floor, 0.3.65', () => {
    expect(WORD_FLOORS['addOn.landing']).toBe('0.3.65');
    expect(installFloorWords(landingAddOn())).toContainEqual({ word: 'addOn.landing', path: 'addOn.landing' });
    expect(one((d) => (d['compatibility'] = { minAdminiumVersion: '0.3.64' }))).toContain('"addOn.landing" is read by Adminium 0.3.65 and later, and compatibility.minAdminiumVersion is 0.3.64');
  });

  it('is filed under marketing', () => {
    expect(issuesOf(changed((d) => (d['categories'] = ['data'])))).toEqual(['categories: an add-on that declares landing pages is filed under the "marketing" category']);
    expect(issuesOf(changed((d) => (d['categories'] = ['data', 'marketing'])))).toEqual([]);
  });

  it('names both parts, tables of its own, each a table of its own, and no other word', () => {
    expect(one((d) => (block(d)['funnels'] = 'paths'))).toContain('addOn.landing.funnels: "paths" is not one of this add-on\'s tables');
    expect(one((d) => (block(d)['funnels'] = 'pages'))).toContain('addOn.landing.funnels: "pages" holds the pages already: each part of landing is a table of its own');
    for (const part of LANDING_PARTS) expect(one((d) => delete block(d)[part]), part).toContain(`addOn.landing.${part}`);
    expect(one((d) => (block(d)['forms'] = 'pages'))).toContain('addOn.landing');
  });

  it('refuses a table without a column the engine reads', () => {
    for (const part of LANDING_PARTS) {
      for (const name of Object.keys(LANDING_COLUMNS[part])) {
        const doc = changed((d) => (tableOf(d, part).columns = tableOf(d, part).columns.filter((column) => column['ref'] !== name)));
        expect(issuesOf(doc).join('\n'), `${part}.${name}`).toContain(`"${part}" holds the ${part}, so it has a column "${name}"`);
      }
    }
  });

  it('refuses a column of the wrong kind', () => {
    expect(one((d) => (columnOf(d, 'pages', 'draft')['type'] = 'text'))).toContain('"pages.draft" is read and written by Adminium as json, not text');
    expect(one((d) => (columnOf(d, 'pages', 'published_at')['type'] = 'date'))).toContain('"pages.published_at" is read and written by Adminium as timestamptz, nullable, not date');
    expect(one((d) => (columnOf(d, 'funnels', 'steps')['type'] = 'text'))).toContain('"funnels.steps" is read and written by Adminium as json, not text');
    expect(one((d) => (columnOf(d, 'pages', 'slug')['type'] = 'int'))).toContain('"pages.slug" is read and written by Adminium as text');
  });

  it('refuses a text too short for what the engine reads', () => {
    expect(one((d) => (columnOf(d, 'pages', 'slug')['maxLength'] = 40))).toContain('"pages.slug" takes up to 80 characters: leave out maxLength, or make it at least that');
    expect(one((d) => (columnOf(d, 'pages', 'name')['maxLength'] = 100))).toContain('"pages.name" takes up to 200 characters');
    expect(one((d) => (columnOf(d, 'funnels', 'rule_id')['maxLength'] = 32))).toContain('"funnels.rule_id" takes up to 64 characters');
    // Unbounded, or longer, is fine.
    expect(one((d) => delete columnOf(d, 'pages', 'slug')['maxLength'])).toBe('');
  });

  it('refuses an enum whose values are not exactly the engine\'s', () => {
    expect(one((d) => (columnOf(d, 'pages', 'state')['enum'] = ['draft', 'live']))).toContain('"pages.state" takes exactly "draft", "live", "off"');
    expect(one((d) => (columnOf(d, 'pages', 'state')['enum'] = ['draft', 'live', 'off', 'archived']))).toContain('"pages.state" takes exactly "draft", "live", "off"');
  });

  it('refuses a column whose emptiness is not the engine\'s, either way', () => {
    expect(one((d) => delete columnOf(d, 'pages', 'published')['nullable'])).toContain('"pages.published" is written empty until there is something to put in it: make it nullable');
    expect(one((d) => delete columnOf(d, 'funnels', 'rule_id')['nullable'])).toContain('"funnels.rule_id" is written empty until there is something to put in it');
    expect(one((d) => (columnOf(d, 'pages', 'draft')['nullable'] = true))).toContain('"pages.draft" always holds a value, which Adminium reads: make it not nullable');
    expect(one((d) => (columnOf(d, 'pages', 'slug')['nullable'] = true))).toContain('"pages.slug" always holds a value');
  });

  it('refuses a key that is not numbered, on either table', () => {
    for (const part of LANDING_PARTS) {
      expect(one((d) => (columnOf(d, part, 'id')['type'] = 'id')), part).toContain(`"${part}" holds the ${part}, so its rows are numbered: its key "id" is an int or a bigint, not id`);
      expect(
        one((d) => (tableOf(d, part).columns = [{ ref: 'uid', type: 'text', maxLength: 36, unique: true }, ...tableOf(d, part).columns.filter((column) => column['ref'] !== 'id')])),
        part,
      ).toContain(`"${part}" holds the ${part}, so its rows are numbered: give it an int key (role "pk")`);
    }
    expect(one((d) => (columnOf(d, 'pages', 'id')['type'] = 'bigint'))).toBe('');
  });

  it('lets staff write both tables, through roles and an app\'s grant', () => {
    expect(one((d) => (tableOf(d, 'pages')['appGrants'] = { actions: ['read', 'create', 'update'], writable: ['name', 'draft'] }))).not.toContain('Adminium alone');
    expect(one((d) => ((d['roles'] as { permissions: string[] }[])[0]!.permissions.push('table:@*:import')))).toBe('');
  });

  it('leaves no other column of either table unfilled', () => {
    expect(one((d) => tableOf(d, 'pages').columns.push({ ref: 'owner', type: 'text', maxLength: 64 }))).toContain('"pages" holds the pages, and Adminium never fills "owner": make it nullable or give it a default');
    expect(one((d) => tableOf(d, 'pages').columns.push({ ref: 'owner', type: 'text', maxLength: 64, nullable: true }))).toBe('');
    expect(one((d) => tableOf(d, 'funnels').columns.push({ ref: 'colour', type: 'text', maxLength: 10, default: 'teal' }))).toBe('');
  });

  it('opens neither table to the public', () => {
    for (const part of LANDING_PARTS) {
      const doc = changed((d) => {
        d['publicAccess'] = [{ table: part, methods: ['GET'], select: ['id'] }];
      });
      expect(issuesOf(doc).join('\n'), part).toContain(`"${part}" holds the ${part}, which Adminium alone serves to strangers: no public entry opens it`);
    }
  });

  it('is never declared beside forms or chat: one package, one door word', () => {
    const withForms = changed((d) => ((d['addOn'] as Doc)['forms'] = { forms: 'pages', answers: 'funnels' }));
    expect(issuesOf(withForms).join('\n')).toContain('addOn.landing: an add-on declares landing pages or forms, not both: each is a package of its own');
    const withChat = changed((d) => ((d['addOn'] as Doc)['chat'] = { conversations: 'pages', messages: 'funnels', answers: 'pages', choices: 'funnels' }));
    expect(issuesOf(withChat).join('\n')).toContain('addOn.landing: an add-on declares landing pages or chat, not both: each is a package of its own');
  });
});
