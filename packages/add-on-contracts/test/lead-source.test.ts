// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `lead-source@1`: the demo passes the conformance suite; a source that
 * reaches a host outside its client, ignores a stop, misses a call it gives or
 * answers outside the contract fails it; and every answer schema refuses an
 * over-long string, an `http:` URL and a 51st company.
 */
import { describe, expect, it } from 'vitest';

import {
  LEAD_SOURCE_ANSWER_SCHEMAS,
  LEAD_SOURCE_CONTRACT,
  LEAD_SOURCE_FACTORY,
  LEAD_SOURCE_VERSION,
  companyFactsSchema,
  foundCompanySchema,
  hasContractVersion,
  parseLeadSourceAnswer,
  type CreateLeadSource,
  type FoundCompany,
} from '../src/index.js';
import { DEMO_LEAD_COMPANIES, createDemoLeadSource, leadSourceConformance, type LeadSourceFixtures } from '../src/testing/index.js';

const FIXTURES: LeadSourceFixtures = { source: 'demo', hosts: ['register.example'], gives: ['find', 'fill', 'people'], key: 'test-key-companies-1' };

const context = (key: string | null = 'test-key-companies-1', signal = new AbortController().signal) => ({
  source: 'demo',
  key,
  signal,
  locale: 'en-US',
  http: () => Promise.reject(new Error('the demo calls nobody')),
});

/** A source that answers as the demo does, with one call replaced. */
const changed = (replace: (source: ReturnType<CreateLeadSource>, ctx: Parameters<CreateLeadSource>[0]) => Partial<ReturnType<CreateLeadSource>>): CreateLeadSource => (ctx) => {
  const demo = createDemoLeadSource(ctx);
  return { ...demo, ...replace(demo, ctx) };
};

describe('the lead-source contract', () => {
  it('is registered at version 1, with its factory\'s name', () => {
    expect(LEAD_SOURCE_CONTRACT).toBe('lead-source');
    expect(LEAD_SOURCE_VERSION).toBe(1);
    expect(LEAD_SOURCE_FACTORY).toBe('createLeadSource');
    expect(hasContractVersion('lead-source', 1)).toBe(true);
    expect(hasContractVersion('lead-source', 2)).toBe(false);
  });
});

describe('the demo source', () => {
  it('passes the conformance suite', async () => {
    const report = await leadSourceConformance(createDemoLeadSource, FIXTURES);
    expect(report.failures).toEqual([]);
    // It calls out to nobody.
    expect(report.reached).toEqual([]);
  });

  it('pages a search, and finds by number or by name and town', async () => {
    const demo = createDemoLeadSource(context());
    const first = await demo.findCompanies!({ activity: '71111', place: { text: 'Leeds', country: 'GB' }, page: { cursor: null, size: 2 } });
    expect(first).toMatchObject({ ok: true, total: 3, next: '2' });
    const second = await demo.findCompanies!({ activity: '71111', place: { text: 'Leeds', country: 'GB' }, page: { cursor: '2', size: 2 } });
    expect(second).toMatchObject({ ok: true, next: null });
    const names = [first, second].flatMap((answer) => (answer.ok ? answer.companies.map((company) => company.name) : []));
    expect(names).toEqual(['Kestrel Yard Architects', 'Millbeck Drawing Office', 'Tannery Row Design']);
    expect(await demo.findCompanies!({ activity: '71', place: { text: 'Leeds', country: 'GB' }, page: { cursor: null, size: 51 } })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(await demo.fillCompany!({ number: '98 000 412' })).toMatchObject({ ok: true, companies: [{ name: 'Kestrel Yard Architects' }] });
    expect(await demo.fillCompany!({ name: 'Ouseburn', town: 'Newcastle upon Tyne' })).toMatchObject({ ok: true, companies: [{ name: 'Ouseburn Studio' }] });
    expect(await demo.fillCompany!({ name: 'Nobody Here', town: 'Leeds' })).toEqual({ ok: true, companies: [], next: null });
    expect(await demo.fillCompany!({})).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('carries a sole trader and a unit that asked not to be approached for sales, both made up', () => {
    expect(DEMO_LEAD_COMPANIES.filter((company) => company.natural).map((company) => company.name)).toEqual(['Atelier Saône Clair']);
    expect(DEMO_LEAD_COMPANIES.filter((company) => company.noMarketing).map((company) => company.name)).toEqual(['Plans Croix-Rousse SARL']);
    for (const company of DEMO_LEAD_COMPANIES) {
      expect(foundCompanySchema.safeParse(company).success, company.name).toBe(true);
      if (company.website !== undefined) expect(new URL(company.website).hostname, company.name).toMatch(/\.example$/);
    }
  });

  it('gives sample numbers that fail their registers\' check digits', () => {
    const luhn = (digits: string) =>
      [...digits].reverse().reduce((sum, c, i) => {
        const d = Number(c) * (i % 2 === 1 ? 2 : 1);
        return sum + (d > 9 ? d - 9 : d);
      }, 0) % 10 === 0;
    const mod11 = (digits: string) => {
      const weights = [3, 2, 7, 6, 5, 4, 3, 2];
      const left = 11 - (weights.reduce((sum, w, i) => sum + w * Number(digits[i]), 0) % 11);
      const check = left === 11 ? 0 : left;
      return check !== 10 && check === Number(digits[8]);
    };
    for (const company of DEMO_LEAD_COMPANIES) {
      const number = company.number!;
      const country = company.address!.country;
      if (country === 'GB') expect(number, company.name).toMatch(/^98\d{6}$/);
      if (country === 'FR') expect(luhn(number), company.name).toBe(false);
      if (country === 'NO') expect(mod11(number), company.name).toBe(false);
    }
  });

  it('refuses the key "refused", and a stopped call ends', async () => {
    expect(await createDemoLeadSource(context('refused')).checkKey()).toMatchObject({ ok: false, code: 'KEY_REFUSED' });
    const stop = new AbortController();
    stop.abort();
    await expect(createDemoLeadSource(context('test-key-companies-1', stop.signal)).checkKey()).rejects.toThrow();
  });
});

describe('the conformance suite fails a source that', () => {
  it('reaches a host outside the client it was handed', async () => {
    const reaching = changed((demo, ctx) => ({
      async findCompanies(query) {
        await ctx.http('https://api.company-information.service.gov.uk/search?q=x').catch(() => undefined);
        return demo.findCompanies!(query);
      },
    }));
    const report = await leadSourceConformance(reaching, FIXTURES);
    expect(report.failures).toEqual([expect.stringContaining('reached https://api.company-information.service.gov.uk, outside its hosts')]);
    expect(report.reached).toEqual(['api.company-information.service.gov.uk']);
  });

  it('reaches a host with its own fetch', async () => {
    const reaching = changed((demo) => ({
      async checkKey() {
        await fetch('https://elsewhere.example/steal').catch(() => undefined);
        return demo.checkKey();
      },
    }));
    const report = await leadSourceConformance(reaching, FIXTURES);
    expect(report.failures.some((failure) => failure.includes('elsewhere.example with its own fetch'))).toBe(true);
  });

  it('reaches its own host over http', async () => {
    const plain = changed((demo, ctx) => ({
      async checkKey() {
        await ctx.http('http://register.example/key').catch(() => undefined);
        return demo.checkKey();
      },
    }));
    expect((await leadSourceConformance(plain, FIXTURES)).failures.some((failure) => failure.includes('http://register.example'))).toBe(true);
  });

  it('ignores a stop', async () => {
    // It answers in its own time, whatever the signal says.
    const deaf = changed(() => ({ checkKey: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true as const }), 300)) }));
    const report = await leadSourceConformance(deaf, { ...FIXTURES, gives: [], refusedKey: null, stopWithinMs: 50 });
    expect(report.failures).toEqual(
      expect.arrayContaining(['a call stopped before it started had not ended after 50 ms', 'a call stopped while it ran had not ended after 50 ms']),
    );
  });

  it('answers a stopped call as if nothing happened', async () => {
    const answers = changed(() => ({ checkKey: () => Promise.resolve({ ok: true as const }) }));
    expect((await leadSourceConformance(answers, { ...FIXTURES, gives: [], refusedKey: null })).failures).toEqual(['a call stopped before it started still answered']);
  });

  it('accepts a refused key, misses a call it gives, or answers outside the contract', async () => {
    const lax = changed(() => ({ checkKey: () => Promise.resolve({ ok: true as const }), findPeople: undefined, fillCompany: () => Promise.resolve({ ok: true, companies: [{ ref: 'x', name: 'x' } as FoundCompany], next: null }) }));
    const report = await leadSourceConformance(lax, FIXTURES);
    expect(report.failures).toEqual(
      expect.arrayContaining(['findPeople is missing', 'a refused key was not answered KEY_REFUSED', expect.stringContaining('fillCompany answered outside the contract')]),
    );
  });

  it('hands the key back in an answer', async () => {
    const leaky = changed((_demo, ctx) => ({ checkKey: () => Promise.resolve({ ok: true as const, account: `account ${ctx.key ?? ''}` }) }));
    expect((await leadSourceConformance(leaky, { ...FIXTURES, refusedKey: null })).failures).toContain('checkKey answered with the key in it');
  });
});

describe('every answer schema', () => {
  const company: FoundCompany = DEMO_LEAD_COMPANIES[0]!;
  const companies = (n: number) => ({ ok: true, companies: Array.from({ length: n }, (_, i) => ({ ...company, ref: `r${String(i)}` })), next: null });

  it('takes the demo\'s own answers', () => {
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse(companies(50)).success).toBe(true);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.checkKey.safeParse({ ok: true, account: 'Demo account' }).success).toBe(true);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findPeople.safeParse({ ok: true, people: [{ name: 'Sam Ellery', email: 'sam@kestrelyard.example', sources: ['https://kestrelyard.example/team'] }] }).success).toBe(true);
  });

  it('refuses a 51st company', () => {
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse(companies(51)).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.fillCompany.safeParse(companies(51)).success).toBe(false);
    const person = { name: 'Sam Ellery', email: 'sam@kestrelyard.example', sources: [] };
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findPeople.safeParse({ ok: true, people: Array.from({ length: 51 }, () => person) }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findPeople.safeParse({ ok: true, people: [{ ...person, sources: Array.from({ length: 21 }, () => 'https://kestrelyard.example/') }] }).success).toBe(false);
  });

  it('refuses an http: URL, and any other scheme', () => {
    for (const url of ['http://kestrelyard.example', 'javascript:alert(1)', 'ftp://kestrelyard.example/x']) {
      expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse({ ...companies(1), companies: [{ ...company, website: url }] }).success, url).toBe(false);
      expect(LEAD_SOURCE_ANSWER_SCHEMAS.fillCompany.safeParse({ ...companies(1), companies: [{ ...company, sourceUrl: url }] }).success, url).toBe(false);
      expect(LEAD_SOURCE_ANSWER_SCHEMAS.fromWebsite.safeParse({ website: url }).success, url).toBe(false);
      expect(LEAD_SOURCE_ANSWER_SCHEMAS.findPeople.safeParse({ ok: true, people: [{ name: 'Sam Ellery', email: 'sam@kestrelyard.example', sources: [url] }] }).success, url).toBe(false);
    }
  });

  it('refuses an over-long string in every call', () => {
    const long = (n: number) => 'x'.repeat(n);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.checkKey.safeParse({ ok: true, account: long(101) }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse({ ...companies(1), companies: [{ ...company, name: long(301) }] }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.fillCompany.safeParse({ ...companies(1), companies: [{ ...company, ref: long(101) }] }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse({ ...companies(1), companies: [{ ...company, officers: [{ name: long(201) }] }] }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse({ ...companies(1), next: long(1025) }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.fromWebsite.safeParse({ about: long(2001) }).success).toBe(false);
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findPeople.safeParse({ ok: true, people: [{ name: long(201), email: 'sam@kestrelyard.example', sources: [] }] }).success).toBe(false);
    // An officer carries a name and a role, never a birth date.
    expect(LEAD_SOURCE_ANSWER_SCHEMAS.findCompanies.safeParse({ ...companies(1), companies: [{ ...company, officers: [{ name: 'Robin Hale', dateOfBirth: '1970-01' }] }] }).success).toBe(false);
    // A website's facts are never a register's flags.
    expect(companyFactsSchema.safeParse({ natural: false }).success).toBe(false);
  });

  it('reads a failed answer as UNAVAILABLE, and a refusal as itself', () => {
    expect(parseLeadSourceAnswer('findCompanies', companies(51)).answer).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(parseLeadSourceAnswer('findCompanies', companies(51)).issues.length).toBeGreaterThan(0);
    expect(parseLeadSourceAnswer('checkKey', { ok: false, code: 'RATE_LIMITED', message: 'Slow down', retryAfterSeconds: 60 })).toEqual({ answer: { ok: false, code: 'RATE_LIMITED', message: 'Slow down', retryAfterSeconds: 60 }, issues: [] });
    expect(parseLeadSourceAnswer('checkKey', { ok: false, code: 'NOPE', message: 'x' }).answer).toMatchObject({ code: 'UNAVAILABLE' });
    expect(parseLeadSourceAnswer('checkKey', { ok: true }).answer).toEqual({ ok: true });
  });
});
