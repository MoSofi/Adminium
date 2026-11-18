// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on block's `sources`: each source reaches only hosts the add-on
 * declares, has a key of its own, gives something; at most eight, each id
 * once, the website reader once; sources and the `lead-source` contract come
 * together, and so do sources and their `leads` tables. (That a key is a
 * secret setting is the manifest's check, where the settings are seen.)
 */
import { describe, expect, it } from 'vitest';

import { addOnBlockSchema, sourceConsentLines } from '../src/index.js';

type Doc = Record<string, unknown>;

const block = (): Doc => ({
  attaches: [{ app: '*' }],
  provides: [{ contract: 'lead-source', version: 1, server: 'dist/server.js' }],
  connect: { kind: 'none' },
  network: { allow: ['api.company-information.service.gov.uk', 'api.hunter.io'] },
  sources: [
    { id: 'companies-house', hosts: ['api.company-information.service.gov.uk'], key: 'companies_house_key', gives: ['find', 'fill'], window: { calls: 600, seconds: 300 } },
    { id: 'hunter', hosts: ['api.hunter.io'], key: 'hunter_key', gives: ['people'], paid: true },
    { id: 'website', reads: 'website', gives: ['fill'] },
  ],
  leads: { foundPeople: 'found_people', fieldSources: 'field_sources' },
});
const sources = (b: Doc) => b['sources'] as Doc[];
const issues = (edit: (b: Doc) => void): string[] => {
  const b = block();
  edit(b);
  const parsed = addOnBlockSchema.safeParse(b);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('an add-on block\'s sources', () => {
  it('parse as drawn, and say their hosts for the consent', () => {
    expect(issues(() => undefined)).toEqual([]);
    expect(sourceConsentLines(addOnBlockSchema.parse(block()))).toEqual([
      { source: 'companies-house', hosts: ['api.company-information.service.gov.uk'], readsWebsites: false },
      { source: 'hunter', hosts: ['api.hunter.io'], readsWebsites: false },
      { source: 'website', hosts: [], readsWebsites: true },
    ]);
  });

  it('refuse a host outside network.allow', () => {
    expect(issues((b) => ((b['network'] as Doc)['allow'] = ['api.hunter.io']))).toContain(
      'sources.0.hosts.0: "api.company-information.service.gov.uk" is not in network.allow: a source reaches only hosts the add-on declares',
    );
    expect(issues((b) => delete b['network'])).toHaveLength(2);
  });

  it('refuse a ninth source, an id twice, the website reader twice, and a key shared', () => {
    expect(issues((b) => {
      for (let n = 0; sources(b).length < 9; n += 1) sources(b).push({ id: `more-${String(n)}`, hosts: ['api.hunter.io'], gives: ['fill'] });
    })).toEqual(['sources: an add-on declares at most 8 sources']);
    expect(issues((b) => {
      for (let n = 0; sources(b).length < 8; n += 1) sources(b).push({ id: `more-${String(n)}`, hosts: ['api.hunter.io'], gives: ['fill'] });
    })).toEqual([]);
    expect(issues((b) => (sources(b)[1]!['id'] = 'companies-house'))).toEqual(['sources: duplicate source id']);
    expect(issues((b) => sources(b).push({ id: 'pages', reads: 'website', gives: ['fill'] }))).toEqual(['sources: the website reader is one source: declare it once']);
    expect(issues((b) => (sources(b)[1]!['key'] = 'companies_house_key'))).toEqual(['sources: each source has a key of its own: two sources name the same setting']);
  });

  it('refuse a source with no hosts or nothing it gives, and a website reader that reaches hosts or holds a key', () => {
    expect(issues((b) => delete sources(b)[0]!['hosts'])).toEqual(['sources.0.hosts: a source names the hosts its code reaches']);
    expect(issues((b) => (sources(b)[0]!['gives'] = []))).toHaveLength(1);
    expect(issues((b) => (sources(b)[0]!['gives'] = ['sell']))).toHaveLength(1);
    expect(issues((b) => (sources(b)[2]!['hosts'] = ['api.hunter.io']))).toEqual(['sources.2.hosts: the website reader is the engine\'s: it names no hosts']);
    expect(issues((b) => (sources(b)[2]!['key'] = 'site_key'))).toEqual(['sources.2.key: the website reader needs no key']);
    expect(issues((b) => (sources(b)[2]!['gives'] = ['people']))).toEqual(['sources.2.gives: the website reader gives "fill" only']);
    expect(issues((b) => (sources(b)[2]!['paid'] = true))).toEqual(['sources.2.paid: the website reader costs nothing']);
  });

  it('come with the lead-source contract, once, and with their leads tables', () => {
    expect(issues((b) => (b['provides'] = []))).toEqual(['provides: an add-on with sources provides the contract "lead-source"']);
    expect(issues((b) => (b['provides'] as Doc[]).push({ contract: 'lead-source', version: 1, server: 'dist/again.js' }))).toEqual([
      'provides: an add-on provides "lead-source" once: the engine calls it per source',
    ]);
    expect(issues((b) => delete b['sources'])).toEqual(
      expect.arrayContaining(['sources: an add-on that provides "lead-source" declares its sources (addOn.sources)', 'sources: addOn.leads keeps what an add-on\'s sources found: it declares its sources (addOn.sources)']),
    );
    expect(issues((b) => delete b['leads'])).toEqual(['leads: an add-on with sources names the tables the engine keeps what they found in (addOn.leads)']);
  });
});
