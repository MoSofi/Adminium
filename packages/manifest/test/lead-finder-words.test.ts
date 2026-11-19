// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on that finds companies and people: its sources (`addOn.sources`),
 * each reaching only hosts the add-on declares with a secret key of its own;
 * the contract they answer by; and the two tables Adminium keeps what they
 * found in (`addOn.leads`), written by Adminium alone. Each refusal is one
 * broken thing of a fixture that validates. And the floor: each new word,
 * the contract's id among them, needs Adminium 0.3.66.
 */
import { sourceConsentLines } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { LEADS_COLUMNS, LEADS_SETTINGS_COLUMNS, installFloorWords, installsLikeAnApp, leadsOf, validateManifest, WORD_FLOORS } from '../src/index.js';
import { LEAD_FINDER_HOSTS, leadFinder } from './lead-finder-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const changed = (edit: (doc: Doc) => void): Doc => {
  const doc = leadFinder();
  edit(doc);
  return doc;
};
const one = (edit: (d: Doc) => void) => issuesOf(changed(edit)).join('\n');
const addOn = (doc: Doc) => doc['addOn'] as Doc;
const sources = (doc: Doc) => addOn(doc)['sources'] as Doc[];
const tableOf = (doc: Doc, ref: string) => (doc['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === ref) as Doc & { columns: Doc[] };
const columnOf = (doc: Doc, table: string, ref: string) => tableOf(doc, table).columns.find((column) => column['ref'] === ref)!;
const role = (doc: Doc) => (doc['roles'] as { permissions: string[] }[])[0]!;

describe('an add-on\'s sources', () => {
  it('validate as drawn, install like an app, and say each source\'s hosts for the consent', () => {
    expect(issuesOf(leadFinder())).toEqual([]);
    const result = validateManifest(leadFinder());
    if (!result.ok || result.manifest.kind !== 'add-on') throw new Error('expected an add-on');
    expect(installsLikeAnApp(result.manifest)).toBe(true);
    expect(leadsOf(result.manifest)).toEqual({ foundPeople: 'found_people', fieldSources: 'field_sources' });
    expect(sourceConsentLines(result.manifest.addOn)).toEqual([
      { source: 'companies-house', hosts: ['api.company-information.service.gov.uk'], readsWebsites: false },
      { source: 'france', hosts: ['recherche-entreprises.api.gouv.fr'], readsWebsites: false },
      { source: 'norway', hosts: ['data.brreg.no'], readsWebsites: false },
      { source: 'hunter', hosts: ['api.hunter.io'], readsWebsites: false },
      { source: 'website', hosts: [], readsWebsites: true },
    ]);
  });

  it('refuses a host that is not in network.allow', () => {
    expect(one((d) => ((addOn(d)['network'] as Doc)['allow'] = LEAD_FINDER_HOSTS.filter((host) => host !== 'api.hunter.io')))).toContain(
      'addOn.sources.3.hosts.0: "api.hunter.io" is not in network.allow: a source reaches only hosts the add-on declares',
    );
  });

  it('refuses a key that names a setting not marked secret, or no setting at all', () => {
    expect(one((d) => (sources(d)[0]!['key'] = 'search_note'))).toContain('addOn.sources.0.key: "search_note" is not marked secret: a source\'s key is a secret setting');
    expect(one((d) => (sources(d)[0]!['key'] = 'nowhere_key'))).toContain('addOn.sources.0.key: "nowhere_key" is not one of this add-on\'s settings: a source\'s key is a secret setting');
    const result = validateManifest(changed((d) => (sources(d)[0]!['key'] = 'search_note')));
    expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toEqual(['SOURCE_RULES']);
  });

  it('refuses a ninth source', () => {
    const nine = one((d) => {
      const list = sources(d);
      for (let n = 0; list.length < 9; n += 1) list.push({ id: `extra-${String(n)}`, hosts: ['data.brreg.no'], gives: ['fill'] });
    });
    expect(nine).toContain('addOn.sources: an add-on declares at most 8 sources');
    // Eight is the most, and fine.
    expect(one((d) => {
      const list = sources(d);
      for (let n = 0; list.length < 8; n += 1) list.push({ id: `extra-${String(n)}`, hosts: ['data.brreg.no'], gives: ['fill'] });
    })).toBe('');
  });

  it('refuses two sources that share a secret', () => {
    expect(one((d) => (sources(d)[3]!['key'] = 'companies_house_key'))).toContain('addOn.sources: each source has a key of its own: two sources name the same setting');
  });

  it('refuses sources without the contract, and the contract without sources', () => {
    expect(one((d) => delete addOn(d)['provides'])).toContain('addOn.provides: an add-on with sources provides the contract "lead-source"');
    expect(
      one((d) => {
        delete addOn(d)['sources'];
        delete addOn(d)['leads'];
      }),
    ).toContain('addOn.sources: an add-on that provides "lead-source" declares its sources (addOn.sources)');
    expect(one((d) => (addOn(d)['provides'] as Doc[]).push({ contract: 'lead-source', version: 1, server: 'dist/other.js' }))).toContain(
      'addOn.provides: an add-on provides "lead-source" once: the engine calls it per source',
    );
  });

  it('refuses an id twice, a source with no hosts, and a website reader with hosts, a key, more than "fill", or twice', () => {
    expect(one((d) => (sources(d)[1]!['id'] = 'companies-house'))).toContain('addOn.sources: duplicate source id');
    expect(one((d) => delete sources(d)[1]!['hosts'])).toContain('addOn.sources.1.hosts: a source names the hosts its code reaches');
    expect(one((d) => (sources(d)[4]!['hosts'] = ['data.brreg.no']))).toContain('addOn.sources.4.hosts: the website reader is the engine\'s: it names no hosts');
    expect(one((d) => (sources(d)[4]!['key'] = 'hunter_key'))).toContain('addOn.sources.4.key: the website reader needs no key');
    expect(one((d) => (sources(d)[4]!['gives'] = ['fill', 'people']))).toContain('addOn.sources.4.gives: the website reader gives "fill" only');
    expect(one((d) => sources(d).push({ id: 'website-two', reads: 'website', gives: ['fill'] }))).toContain('addOn.sources: the website reader is one source: declare it once');
    expect(one((d) => (sources(d)[0]!['gives'] = ['find', 'find']))).toContain('addOn.sources.0.gives: a source names each thing it gives once');
    expect(one((d) => (sources(d)[0]!['id'] = 'Companies_House'))).toContain('a source id is kebab-case');
  });

  it('reaches its hosts only through outbound-http', () => {
    expect(
      one((d) => {
        delete d['capabilities'];
        d['compatibility'] = { minAdminiumVersion: '0.3.66' };
      }),
    ).toContain('capabilities: the source "companies-house" reaches its hosts through outbound-http: declare the capability');
  });
});

describe('an add-on\'s leads tables', () => {
  it('are required beside sources, and need sources', () => {
    expect(one((d) => delete addOn(d)['leads'])).toContain('addOn.leads: an add-on with sources names the tables the engine keeps what they found in (addOn.leads)');
  });

  it('refuse a missing column, a column of the wrong kind, and pages kept as JSON', () => {
    expect(one((d) => (tableOf(d, 'found_people').columns = tableOf(d, 'found_people').columns.filter((column) => column['ref'] !== 'tell_by')))).toContain(
      '"found_people" holds the people found, so it has a column "tell_by"',
    );
    expect(one((d) => (columnOf(d, 'field_sources', 'found_at')['type'] = 'date'))).toContain('"field_sources.found_at" is read and written by Adminium as');
    const json = one((d) => {
      const pages = columnOf(d, 'found_people', 'source_pages');
      pages['type'] = 'json';
    });
    expect(json).toContain('"found_people.source_pages" is read and written by Adminium as');
    expect(json).toContain('not json');
    expect(one((d) => (columnOf(d, 'found_people', 'state')['enum'] = ['waiting', 'told']))).toContain('"found_people.state" takes exactly "waiting", "told", "failed", "objected"');
    expect(one((d) => (columnOf(d, 'found_people', 'person_key')['maxLength'] = 100))).toContain('"found_people.person_key" takes up to 200 characters');
    expect(one((d) => (columnOf(d, 'found_people', 'told_at')['nullable'] = false))).toContain('"found_people.told_at" is written empty until there is something to put in it');
    expect(one((d) => (tableOf(d, 'field_sources').columns[0]!['type'] = 'text'))).toContain('"field_sources" holds the fields\' sources, so its rows are numbered');
  });

  it('keep a found person\'s address, where their tell mail goes: there, nullable, at least 320 wide', () => {
    expect(one((d) => (tableOf(d, 'found_people').columns = tableOf(d, 'found_people').columns.filter((column) => column['ref'] !== 'email')))).toContain('"found_people" holds the people found, so it has a column "email"');
    expect(one((d) => (columnOf(d, 'found_people', 'email')['maxLength'] = 254))).toContain('"found_people.email" takes up to 320 characters');
    expect(one((d) => (columnOf(d, 'found_people', 'email')['nullable'] = false))).toContain('"found_people.email" is written empty until there is something to put in it');
  });

  it('name each field once', () => {
    expect(one((d) => delete tableOf(d, 'field_sources')['unique'])).toContain('"field_sources" names each field once: make "table_ref", "row_key", "column_name" a unique set');
  });

  it('are written by no role, grant or step of the add-on, and opened to no stranger', () => {
    expect(one((d) => role(d).permissions.push('table:@found_people:create'))).toContain('"finder" may create "found_people", and the people found are written by Adminium alone: a role reads them');
    expect(one((d) => role(d).permissions.push('table:@field_sources:update'))).toContain('"finder" may update "field_sources"');
    expect(one((d) => role(d).permissions.push('table:@*:import'))).toContain('"finder" may import "found_people"');
    expect(one((d) => (tableOf(d, 'found_people')['appGrants'] = { actions: ['read'] }))).toBe('');
    expect(one((d) => (tableOf(d, 'found_people')['appGrants'] = { actions: ['read', 'update'], writable: ['purpose'] }))).toContain(
      'the people found are written by Adminium alone: an app\'s role may only read "found_people"',
    );
    const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
    const words = (t: string) => Object.fromEntries(LOCALES.map((locale) => [locale, t]));
    const step = { key: 'note', name: words('Add a note'), does: words('Adds a line'), inputs: [{ key: 'body', label: words('Text'), kind: 'text', required: true }], writes: { table: 'found_people', values: { purpose: { input: 'body' } } } };
    expect(one((d) => (addOn(d)['steps'] = [step]))).toContain('the people found are written by Adminium alone: the step "note" may not write a row of "found_people"');
    expect(one((d) => (d['publicAccess'] = [{ table: 'field_sources', methods: ['GET'], select: ['id'] }]))).toContain(
      '"field_sources" holds the fields\' sources, which Adminium alone writes: no public entry opens it',
    );
    expect(one((d) => tableOf(d, 'found_people').columns.push({ ref: 'rating', type: 'text', maxLength: 10 }))).toContain('"found_people" is written by Adminium alone, which never fills "rating"');
  });

  it('keep their settings where the engine reads them', () => {
    expect(one((d) => (tableOf(d, 'finder_settings').columns = tableOf(d, 'finder_settings').columns.filter((column) => column['ref'] !== 'people_on')))).toContain(
      '"finder_settings" holds the settings of what is found, so it has a column "people_on"',
    );
    expect(one((d) => (columnOf(d, 'finder_settings', 'keep_years')['default'] = 11))).toContain('"finder_settings.keep_years" is a number of years from 1 to 10 (3 by default)');
    expect(one((d) => delete addOn(d)['settingsTable'])).toContain('addOn.settingsTable: an add-on that declares leads keeps whether people are found');
  });

  it('are filed under marketing', () => {
    expect(one((d) => (d['categories'] = ['data']))).toContain('categories: an add-on that declares leads is filed under the "marketing" category');
  });

  it('say every column the engine reads', () => {
    expect(Object.keys(LEADS_COLUMNS.foundPeople)).toEqual(['person_table', 'person_key', 'company_table', 'company_key', 'source', 'found_at', 'purpose', 'tell_by', 'told_at', 'outbox_id', 'state', 'source_pages', 'email']);
    expect(Object.keys(LEADS_COLUMNS.fieldSources)).toEqual(['table_ref', 'row_key', 'column_name', 'source', 'found_at', 'value_hash']);
    expect(Object.keys(LEADS_SETTINGS_COLUMNS)).toEqual(['people_on', 'purpose', 'keep_years']);
  });
});

describe('the floor of the words that find companies', () => {
  it('is 0.3.66 for each', () => {
    for (const word of ['addOn.sources', 'addOn.leads', 'provides.lead-source', 'people.lead'] as const) expect(WORD_FLOORS[word], word).toBe('0.3.66');
    expect(installFloorWords(leadFinder()).map((found) => found.word)).toEqual(expect.arrayContaining(['addOn.sources', 'addOn.leads', 'provides.lead-source']));
  });

  it('refuses each at 0.3.65, the contract\'s id among them, with the floor message', () => {
    const older = issuesOf(changed((d) => (d['compatibility'] = { minAdminiumVersion: '0.3.65', requires: ['outbound-http'] })));
    expect(older).toEqual(
      expect.arrayContaining([
        'addOn.sources: "addOn.sources" is read by Adminium 0.3.66 and later, and compatibility.minAdminiumVersion is 0.3.65: set it to 0.3.66 or later',
        'addOn.leads: "addOn.leads" is read by Adminium 0.3.66 and later, and compatibility.minAdminiumVersion is 0.3.65: set it to 0.3.66 or later',
        'addOn.provides.0.contract: "provides.lead-source" is read by Adminium 0.3.66 and later, and compatibility.minAdminiumVersion is 0.3.65: set it to 0.3.66 or later',
      ]),
    );
    // A package that only provides the contract (refused for its missing sources too) still names the release it needs.
    const bare = issuesOf(
      changed((d) => {
        d['compatibility'] = { minAdminiumVersion: '0.3.65', requires: ['outbound-http'] };
        delete addOn(d)['sources'];
        delete addOn(d)['leads'];
      }),
    );
    expect(bare).toContain('addOn.provides.0.contract: "provides.lead-source" is read by Adminium 0.3.66 and later, and compatibility.minAdminiumVersion is 0.3.65: set it to 0.3.66 or later');
  });
});
