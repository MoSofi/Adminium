// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The lead door's pure parts: how a found company is compared with a row
 * ("already here"), how its facts meet a companies table's columns, what may
 * not be added, which sources a rule may ask, and the website's words.
 */
import { describe, expect, it } from 'vitest';

import { addRefusal, withOfficersFor } from '../src/leads/flags.js';
import { domainKey, nameKey, numberKey, townKey } from '../src/leads/match.js';
import { FoundMemory, MEMORY_TTL_MS } from '../src/leads/memory.js';
import { freeRegisters, isRegister, registerCountry } from '../src/leads/registers.js';
import { pageFacts, websiteWords } from '../src/leads/website-facts.js';
import { columnValue, factsByField, valueHash } from '../src/leads/write.js';
import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';

describe('"already here": how names, numbers, domains and towns compare', () => {
  it('a legal form, case, accents and punctuation aside', () => {
    expect(nameKey('ACME LTD')).toBe(nameKey('Acme Limited'));
    expect(nameKey('Plans Croix-Rousse S.A.R.L.')).toBe(nameKey('plans croix rousse'));
    expect(nameKey('Atelier Saône Clair')).toBe(nameKey('ATELIER SAONE CLAIR SAS'));
    expect(nameKey('Fjordlys Arkitekter AS')).toBe('fjordlys arkitekter');
    expect(nameKey('Kestrel & Wren')).toBe(nameKey('Kestrel and Wren Ltd'));
    // A name that is only a legal form keeps it: nothing would be left to compare.
    expect(nameKey('Limited')).toBe('limited');
    expect(nameKey('Kestrel Yard')).not.toBe(nameKey('Kestrel Yard Two'));
  });

  it('numbers by their letters and digits, domains without www, scheme, port or path', () => {
    expect(numberKey('512 378 901')).toBe(numberKey('512378901'));
    expect(numberKey('sc-98.0001')).toBe('SC980001');
    expect(domainKey('https://www.Kestrelyard.example/about?x=1')).toBe('kestrelyard.example');
    expect(domainKey('kestrelyard.example')).toBe('kestrelyard.example');
    expect(domainKey('http://kestrelyard.example:8080')).toBe('kestrelyard.example');
    expect(domainKey('javascript:alert(1)')).toBe('');
    expect(domainKey('not a site')).toBe('');
    expect(townKey('Saint-Étienne')).toBe(townKey('SAINT ETIENNE'));
  });
});

describe('a found company\'s facts, as columns take them', () => {
  it('cut to the width, a long website left out, a country only as two letters, what it does with its code when it fits', () => {
    expect(columnValue('name', 'x'.repeat(130), 120)).toHaveLength(120);
    expect(columnValue('website', `https://${'a'.repeat(60)}.example`, 60)).toBeNull();
    expect(columnValue('website', 'http://plain.example', 60)).toBeNull();
    expect(columnValue('country', 'England', 2)).toBeNull();
    expect(columnValue('country', 'GB', 2)).toBe('GB');
    expect(columnValue('activity', 'Architectural activities · 71111', 80)).toBe('Architectural activities · 71111');
    expect(columnValue('activity', 'Architectural activities · 71111', 20)).toBe('Architectural activ…');
    const facts = factsByField({ name: 'Kestrel‮ Yard\nArchitects', activity: { code: '71111', label: 'Architectural activities' } });
    // Direction marks and line breaks never reach a row.
    expect(facts.name).toBe('Kestrel Yard Architects');
    expect(facts.activity).toBe('Architectural activities · 71111');
  });

  it('hashes a value as the record page reads it: its text, trimmed', () => {
    expect(valueHash('  98003391 ')).toBe(valueHash('98003391'));
    expect(valueHash(98003391)).toBe(valueHash('98003391'));
    expect(valueHash('98003391')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('what may not be added', () => {
  it('a unit that objected to sales contact, ever; a sole trader while people are off, or without their address', () => {
    expect(addRefusal({ noMarketing: true, natural: false }, true, 'x@kestrelyard.example')).toBe('no-marketing');
    expect(addRefusal({ noMarketing: false, natural: true }, false)).toBe('sole-trader');
    expect(addRefusal({ noMarketing: false, natural: true }, true, null)).toBe('needs-address');
    expect(addRefusal({ noMarketing: false, natural: true }, true, 'claire@saone.example')).toBeNull();
    expect(addRefusal({ noMarketing: false, natural: false }, false)).toBeNull();
  });

  it('officers are never handed on while people are off', () => {
    const company = { name: 'Kestrel Yard Architects', officers: [{ name: 'Robin Hale', role: 'director' }] };
    expect(withOfficersFor(company, false)).toEqual({ name: 'Kestrel Yard Architects' });
    expect(withOfficersFor(company, true)).toEqual(company);
  });
});

describe('which sources a rule may ask', () => {
  const manifest = leadFinder() as never;
  it('the free registers that fill in a company: never the website, a paid source or a people source', () => {
    expect(freeRegisters(manifest).map((entry) => entry.id)).toEqual(['companies-house', 'france', 'norway']);
    const paid = { addOn: { sources: [{ id: 'oc', hosts: ['api.opencorporates.example'], gives: ['fill'], paid: true }, { id: 'web', reads: 'website', gives: ['fill'] }, { id: 'both', hosts: ['x.example'], gives: ['fill', 'people'] }] } } as never;
    expect(freeRegisters(paid)).toEqual([]);
  });

  it('a register\'s country is its hosts\' country code; a service across countries has none', () => {
    const [ch, fr, no, hunter] = (leadFinder() as { addOn: { sources: never[] } }).addOn.sources;
    expect(registerCountry(ch!)).toBe('GB');
    expect(registerCountry(fr!)).toBe('FR');
    expect(registerCountry(no!)).toBe('NO');
    expect(isRegister(hunter!)).toBe(false);
    expect(registerCountry(hunter!)).toBeNull();
  });
});

describe('the website, read by the engine', () => {
  it('says one of four things when it was not read, never why in detail', () => {
    expect(websiteWords({ outcome: 'asks', host: 'other.example' })).toBe('This website sends visitors to other.example.');
    expect(websiteWords({ outcome: 'refused-by-site' })).toBe('This website asks tools not to read it.');
    expect(websiteWords({ outcome: 'not-a-page' })).toBe("This address isn't a web page we can read.");
    expect(websiteWords({ outcome: 'unreachable' })).toBe("Couldn't reach the website.");
  });

  it('takes the name, the description, the site over https and its first switchboard number', () => {
    const facts = pageFacts({ url: 'https://kestrelyard.example', finalUrl: 'https://kestrelyard.example/home', name: 'Kestrel Yard Architects', about: 'Homes and workshops.', jsonLd: [], emails: ['info@kestrelyard.example'], phones: ['0113 496 0412'] });
    expect(facts).toEqual({ name: 'Kestrel Yard Architects', about: 'Homes and workshops.', website: 'https://kestrelyard.example', sourceUrl: 'https://kestrelyard.example/home', phone: '0113 496 0412' });
    // Read over plain http: no website and no source page from it.
    expect(pageFacts({ url: 'http://plain.example', finalUrl: 'http://plain.example/', jsonLd: [], emails: [], phones: [] })).toEqual({});
  });
});

describe('what a source answered, kept for the next click', () => {
  it('per person and install, for an hour', () => {
    let at = 1_000_000;
    const memory = new FoundMemory(() => at);
    const dana = FoundMemory.owner('inst_1', 'usr_dana');
    memory.rememberCompanies(dana, 'france', [{ ref: 'fr-1', name: 'Atelier', natural: true, noMarketing: false }]);
    expect(memory.company(dana, 'france', 'fr-1')?.natural).toBe(true);
    expect(memory.company(FoundMemory.owner('inst_1', 'usr_omar'), 'france', 'fr-1')).toBeNull();
    expect(memory.company(dana, 'norway', 'fr-1')).toBeNull();
    at += MEMORY_TTL_MS + 1;
    expect(memory.company(dana, 'france', 'fr-1')).toBeNull();
  });
});
