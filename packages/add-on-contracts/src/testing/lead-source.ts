// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `lead-source@1`: the demo source and the conformance suite.
 *
 * THE DEMO ({@link createDemoLeadSource}) answers every question from a
 * made-up sample: companies that do not exist, numbers that fail their
 * registers' check digits (UK `98…`, a SIREN that fails Luhn, a Norwegian
 * number that fails mod-11), `.example` websites and made-up streets. It
 * makes no call out. It honours the signal, refuses the key `refused`, pages,
 * and carries one French sole trader (`natural`) and one French unit that
 * asked not to be approached for sales (`noMarketing`).
 *
 * THE SUITE ({@link leadSourceConformance}) is what every adapter runs in its
 * own tests: each call the source declares answers something the contract's
 * schemas accept, a stopped call ends, a refused key is `KEY_REFUSED`, no key
 * value comes back in an answer, and nothing is reached outside the client the
 * suite hands over (it records every host, and stands in for the global
 * `fetch` for the run). It returns what failed, so an adapter's test reads
 * `expect((await leadSourceConformance(create, fixtures)).failures).toEqual([])`.
 *
 * Neither imports vitest: an add-on's demo transport may load this file at
 * run time (`@adminium/add-on-contracts/testing/lead-source`).
 */
import {
  LEAD_SOURCE_ANSWER_SCHEMAS,
  LEAD_SOURCE_CALL_FOR,
  LEAD_SOURCE_PAGE_MAX,
  isLeadSourceError,
  leadSourceErrorSchema,
  type CompaniesFound,
  type CompanyFacts,
  type CreateLeadSource,
  type FillQuery,
  type FindQuery,
  type FoundCompany,
  type FoundPerson,
  type LeadSource,
  type LeadSourceCall,
  type LeadSourceContext,
  type LeadSourceError,
  type LeadSourceGive,
  type LeadSourceHttpClient,
  type LeadSourceHttpResponse,
  type PeopleQuery,
  type WebsitePage,
} from '../lead-source.js';

// ─── The demo ───────────────────────────────────────────────────────────────

/** The key the demo refuses: anything else is accepted. */
export const DEMO_LEAD_SOURCE_REFUSED_KEY = 'refused';

const UK_ACTIVITY = { code: '71111', label: 'Architectural activities' };
const FR_ACTIVITY = { code: '71.11Z', label: "Activités d'architecture" };
const NO_ACTIVITY = { code: '71.110', label: 'Arkitekttjenester' };

/** The made-up companies, in the order a search lists them. */
export const DEMO_LEAD_COMPANIES: readonly FoundCompany[] = [
  {
    ref: 'gb-98000412',
    name: 'Kestrel Yard Architects',
    number: '98000412',
    website: 'https://kestrelyard.example',
    phone: '0113 496 0412',
    address: { lines: 'Unit 4, Calder Wharf Lane', town: 'Leeds', region: 'West Yorkshire', postalCode: 'LS1 0ZZ', country: 'GB' },
    activity: UK_ACTIVITY,
    about: 'A small practice drawing homes and workshops.',
    natural: false,
    noMarketing: false,
    officers: [{ name: 'Robin Hale', role: 'director' }],
    sourceUrl: 'https://register.example/company/98000412',
  },
  {
    ref: 'gb-98001537',
    name: 'Millbeck Drawing Office',
    number: '98001537',
    website: 'https://millbeck.example',
    address: { lines: '22 Fennel Row', town: 'Leeds', region: 'West Yorkshire', postalCode: 'LS2 0ZZ', country: 'GB' },
    activity: UK_ACTIVITY,
    natural: false,
    noMarketing: false,
    officers: [{ name: 'Jo Ashby', role: 'director' }],
    sourceUrl: 'https://register.example/company/98001537',
  },
  {
    ref: 'gb-98003391',
    name: 'Tannery Row Design',
    number: '98003391',
    website: 'https://tanneryrow.example',
    address: { lines: '7 Tannery Row', town: 'Leeds', region: 'West Yorkshire', postalCode: 'LS3 0ZZ', country: 'GB' },
    activity: UK_ACTIVITY,
    natural: false,
    noMarketing: false,
    sourceUrl: 'https://register.example/company/98003391',
  },
  {
    ref: 'gb-98002264',
    name: 'Ouseburn Studio',
    number: '98002264',
    website: 'https://ouseburn.example',
    address: { lines: '3 Lime Kiln Court', town: 'Newcastle upon Tyne', region: 'Tyne and Wear', postalCode: 'NE1 0ZZ', country: 'GB' },
    activity: UK_ACTIVITY,
    natural: false,
    noMarketing: false,
    sourceUrl: 'https://register.example/company/98002264',
  },
  {
    // A sole trader under a trading name: a natural person in the register.
    ref: 'fr-412345678',
    name: 'Atelier Saône Clair',
    number: '412345678',
    address: { lines: '9 rue des Tisserands', town: 'Lyon', postalCode: '69001', country: 'FR' },
    activity: FR_ACTIVITY,
    natural: true,
    noMarketing: false,
    sourceUrl: 'https://register.example/unite/412345678',
  },
  {
    // A unit that asked not to be approached for sales.
    ref: 'fr-512378901',
    name: 'Plans Croix-Rousse SARL',
    number: '512378901',
    website: 'https://plans-croix-rousse.example',
    address: { lines: '41 montée des Canuts', town: 'Lyon', postalCode: '69004', country: 'FR' },
    activity: FR_ACTIVITY,
    natural: false,
    noMarketing: true,
    sourceUrl: 'https://register.example/unite/512378901',
  },
  {
    ref: 'no-923456781',
    name: 'Fjordlys Arkitekter AS',
    number: '923456781',
    website: 'https://fjordlys.example',
    address: { lines: 'Lysverkgata 5', town: 'Bergen', postalCode: '5003', country: 'NO' },
    activity: NO_ACTIVITY,
    natural: false,
    noMarketing: false,
    sourceUrl: 'https://register.example/enhet/923456781',
  },
];

/** The made-up people, by their company's domain. */
export const DEMO_LEAD_PEOPLE: Readonly<Record<string, readonly FoundPerson[]>> = {
  'kestrelyard.example': [
    { name: 'Robin Hale', role: 'Director', email: 'robin@kestrelyard.example', sources: ['https://kestrelyard.example/team'] },
    { name: 'Sam Ellery', role: 'Architect', email: 'sam@kestrelyard.example', sources: ['https://kestrelyard.example/team'] },
  ],
  'millbeck.example': [{ name: 'Jo Ashby', role: 'Director', email: 'jo@millbeck.example', sources: ['https://millbeck.example/about'] }],
  'fjordlys.example': [{ name: 'Kari Vik', role: 'Daglig leder', email: 'kari@fjordlys.example', sources: ['https://fjordlys.example/kontakt'] }],
};

/** The plain form of a name or number a search compares. */
const plain = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A stopped call throws as `fetch` does; else it gives the event loop one turn, so a stop in that turn is heard. */
function step(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new DOMException('The call was stopped.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('The call was stopped.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, 1);
    signal.addEventListener('abort', stop, { once: true });
  });
}

const refusal = (code: LeadSourceError['code'], message: string): LeadSourceError => ({ ok: false, code, message });

/**
 * The demo source: every question answered from {@link DEMO_LEAD_COMPANIES}
 * and {@link DEMO_LEAD_PEOPLE}. A {@link CreateLeadSource}: the engine builds
 * it per call as it builds a real one.
 */
export const createDemoLeadSource: CreateLeadSource = (context: LeadSourceContext): LeadSource => {
  const { signal } = context;
  return {
    async checkKey() {
      await step(signal);
      if (context.key === DEMO_LEAD_SOURCE_REFUSED_KEY) return refusal('KEY_REFUSED', 'The demo refuses this key.');
      return { ok: true, account: 'Demo account' };
    },

    async findCompanies(query: FindQuery): Promise<CompaniesFound | LeadSourceError> {
      await step(signal);
      const { size, cursor } = query.page;
      if (!Number.isInteger(size) || size < 1 || size > LEAD_SOURCE_PAGE_MAX) return refusal('INVALID_REQUEST', `A page holds 1 to ${String(LEAD_SOURCE_PAGE_MAX)} companies.`);
      const from = cursor === null ? 0 : Number(cursor);
      if (!Number.isInteger(from) || from < 0) return refusal('INVALID_REQUEST', 'The page cursor is not one the demo gave.');
      const place = plain(query.place.text);
      const division = plain(query.activity).slice(0, 2);
      const matching = DEMO_LEAD_COMPANIES.filter(
        (company) =>
          company.address?.country === query.place.country &&
          (division === '' || plain(company.activity?.code ?? '').startsWith(division)) &&
          (place === '' || plain(company.address.town ?? '').includes(place) || plain(company.address.region ?? '').includes(place)),
      );
      const page = matching.slice(from, from + size);
      const next = from + size < matching.length ? String(from + size) : null;
      return { ok: true, companies: page, next, total: matching.length };
    },

    async fillCompany(query: FillQuery): Promise<CompaniesFound | LeadSourceError> {
      await step(signal);
      const inCountry = (company: FoundCompany) => query.country === undefined || company.address?.country === query.country;
      if (query.number !== undefined && query.number.trim() !== '') {
        const number = plain(query.number);
        return { ok: true, companies: DEMO_LEAD_COMPANIES.filter((company) => inCountry(company) && plain(company.number ?? '') === number), next: null };
      }
      if (query.name === undefined || query.name.trim() === '') return refusal('INVALID_REQUEST', 'Give a company number, or a name.');
      const name = plain(query.name);
      const town = plain(query.town ?? '');
      const companies = DEMO_LEAD_COMPANIES.filter((company) => inCountry(company) && plain(company.name).includes(name) && (town === '' || plain(company.address?.town ?? '') === town));
      return { ok: true, companies, next: null };
    },

    async fromWebsite(page: WebsitePage): Promise<CompanyFacts | LeadSourceError> {
      await step(signal);
      const facts: CompanyFacts = {};
      const fromJsonLd = page.jsonLd[0];
      const name = page.name ?? fromJsonLd?.name;
      if (name !== undefined && name.trim() !== '') facts.name = name.trim().slice(0, 300);
      if (page.about !== undefined && page.about.trim() !== '') facts.about = page.about.trim().slice(0, 2000);
      if (page.finalUrl.startsWith('https://')) {
        const site = new URL(page.finalUrl);
        facts.website = site.origin;
        facts.sourceUrl = site.href;
      }
      const phone = page.phones[0] ?? fromJsonLd?.phone;
      if (phone !== undefined) facts.phone = phone.slice(0, 40);
      const address = page.address ?? fromJsonLd?.address;
      if (address !== undefined) facts.address = address;
      return facts;
    },

    async findPeople(query: PeopleQuery) {
      await step(signal);
      return { ok: true, people: [...(DEMO_LEAD_PEOPLE[query.domain.toLowerCase()] ?? [])] };
    },
  };
};

// ─── The conformance suite ──────────────────────────────────────────────────

/** What one adapter's run of the suite is given. */
export interface LeadSourceFixtures {
  /** The `addOn.sources[].id` the run is for. */
  source: string;
  /** That source's hosts: anything else the source reaches fails the run. */
  hosts: readonly string[];
  /** What the source gives, as its manifest says: each one's call must be there. */
  gives: readonly LeadSourceGive[];
  /** A key the source accepts, or null for a source that needs none. */
  key: string | null;
  /** A key the source refuses (`KEY_REFUSED`); null for a source that needs none. Default `refused`. */
  refusedKey?: string | null;
  /**
   * The service's answers, for an adapter that calls out: the suite's client
   * answers each request the source makes to one of its hosts with this.
   * Default: a 404 with an empty body.
   */
  respond?: (url: URL, init: { method?: string; headers?: Record<string, string>; body?: string } | undefined) => LeadSourceHttpResponse | Promise<LeadSourceHttpResponse>;
  /** The questions asked; each has a default the demo answers. */
  find?: FindQuery;
  fill?: FillQuery;
  people?: PeopleQuery;
  /** Asked of `fromWebsite`, when the source has it. */
  website?: WebsitePage;
  locale?: string;
  /** How long a stopped call may take to end. Default 2000 ms. */
  stopWithinMs?: number;
}

export interface LeadSourceConformanceReport {
  /** What failed, one sentence each. Empty: the source conforms. */
  failures: string[];
  /** Every host the source asked the suite's client for, in order. */
  reached: string[];
}

const DEFAULT_FIND: FindQuery = { activity: '71111', place: { text: 'Leeds', country: 'GB' }, page: { cursor: null, size: 2 } };
const DEFAULT_FILL: FillQuery = { name: 'Kestrel Yard', town: 'Leeds', country: 'GB' };
const DEFAULT_PEOPLE: PeopleQuery = { domain: 'kestrelyard.example', company: 'Kestrel Yard Architects' };
const DEFAULT_WEBSITE: WebsitePage = {
  url: 'https://kestrelyard.example',
  finalUrl: 'https://kestrelyard.example/',
  name: 'Kestrel Yard Architects',
  about: 'A small practice drawing homes and workshops.',
  jsonLd: [],
  emails: ['info@kestrelyard.example'],
  phones: ['0113 496 0412'],
};

/** A response with only a status and a body. */
function plainResponse(status: number, body: string): LeadSourceHttpResponse {
  return { status, headers: { get: () => null }, text: () => Promise.resolve(body) };
}

/** Why an answer is not one the call may give: [] when it is. */
function answerIssues(call: LeadSourceCall, answer: unknown): string[] {
  const parsed = isLeadSourceError(answer) ? leadSourceErrorSchema.safeParse(answer) : LEAD_SOURCE_ANSWER_SCHEMAS[call].safeParse(answer);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(answer)'}: ${issue.message}`);
}

/** Whether a promise settles (either way) within `ms`. */
async function settlesWithin(work: Promise<unknown>, ms: number): Promise<{ settled: boolean; value?: unknown; threw?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
  });
  try {
    const outcome = await Promise.race([work.then((value) => ({ value }), () => ({ threw: true as const })), late]);
    if (outcome === 'late') return { settled: false };
    return { settled: true, ...outcome };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the suite against one source and says what failed. The source is built
 * with `create` for each question, as the engine builds it, with the suite's
 * recording client in place of the narrowed one.
 */
export async function leadSourceConformance(create: CreateLeadSource, fixtures: LeadSourceFixtures): Promise<LeadSourceConformanceReport> {
  const failures: string[] = [];
  const reached: string[] = [];
  const hosts = new Set(fixtures.hosts.map((host) => host.toLowerCase()));
  const stopWithin = fixtures.stopWithinMs ?? 2000;

  const http: LeadSourceHttpClient = async (url, init) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      failures.push(`asked its client for "${String(url)}", which is no URL`);
      throw new Error('not a URL');
    }
    reached.push(target.hostname);
    if (target.protocol !== 'https:' || !hosts.has(target.hostname.toLowerCase())) {
      failures.push(`reached ${target.protocol}//${target.hostname}, outside its hosts (${[...hosts].join(', ') || 'none'})`);
      throw new Error('outside the source\'s hosts');
    }
    return fixtures.respond === undefined ? plainResponse(404, '') : fixtures.respond(target, init);
  };

  const make = (key: string | null, signal: AbortSignal = new AbortController().signal): LeadSource =>
    create({ source: fixtures.source, key, http, signal, locale: fixtures.locale ?? 'en-US' });

  // The source's own fetch reaches nothing for the run: every call out goes through the client handed over.
  const ownFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const where = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let host = where;
    try {
      host = new URL(where).hostname;
    } catch {
      // The raw text names it well enough.
    }
    failures.push(`reached ${host} with its own fetch, outside the client it was handed`);
    return Promise.reject(new Error('the source called fetch itself'));
  }) as typeof globalThis.fetch;

  const secret = fixtures.key !== null && fixtures.key.length >= 6 ? fixtures.key : null;
  const check = (call: LeadSourceCall, answer: unknown) => {
    for (const issue of answerIssues(call, answer)) failures.push(`${call} answered outside the contract: ${issue}`);
    if (secret !== null && JSON.stringify(answer ?? null).includes(secret)) failures.push(`${call} answered with the key in it`);
  };
  const asked = async (call: LeadSourceCall, run: () => Promise<unknown> | undefined): Promise<void> => {
    try {
      const work = run();
      if (work === undefined) {
        failures.push(`${call} is missing`);
        return;
      }
      check(call, await work);
    } catch (error) {
      failures.push(`${call} threw (${error instanceof Error ? error.message : String(error)}): a refusal is an answer`);
    }
  };

  try {
    // The key it is given: checked, in the contract's shape.
    await asked('checkKey', () => make(fixtures.key).checkKey());

    // Each thing the source gives, through its own call.
    for (const give of new Set(fixtures.gives)) {
      const call = LEAD_SOURCE_CALL_FOR[give];
      if (call === 'findCompanies') await asked(call, () => make(fixtures.key).findCompanies?.(fixtures.find ?? DEFAULT_FIND));
      if (call === 'fillCompany') await asked(call, () => make(fixtures.key).fillCompany?.(fixtures.fill ?? DEFAULT_FILL));
      if (call === 'findPeople') await asked(call, () => make(fixtures.key).findPeople?.(fixtures.people ?? DEFAULT_PEOPLE));
    }
    const reader = make(fixtures.key);
    if (reader.fromWebsite !== undefined) await asked('fromWebsite', () => reader.fromWebsite?.(fixtures.website ?? DEFAULT_WEBSITE));

    // A refused key is said as one.
    const refusedKey = fixtures.refusedKey === undefined ? (fixtures.key === null ? null : DEMO_LEAD_SOURCE_REFUSED_KEY) : fixtures.refusedKey;
    if (refusedKey !== null) {
      try {
        const answer = await make(refusedKey).checkKey();
        check('checkKey', answer);
        if (!isLeadSourceError(answer) || answer.code !== 'KEY_REFUSED') failures.push('a refused key was not answered KEY_REFUSED');
      } catch (error) {
        failures.push(`checkKey threw on a refused key (${error instanceof Error ? error.message : String(error)}): a refusal is an answer`);
      }
    }

    // Stop: a call stopped before it starts ends with no answer, and one stopped while it runs ends.
    const stopped = new AbortController();
    stopped.abort();
    const before = await settlesWithin(make(fixtures.key, stopped.signal).checkKey(), stopWithin);
    if (!before.settled) failures.push(`a call stopped before it started had not ended after ${String(stopWithin)} ms`);
    else if (before.threw !== true && !isLeadSourceError(before.value)) failures.push('a call stopped before it started still answered');
    const during = new AbortController();
    const running = make(fixtures.key, during.signal).checkKey();
    during.abort();
    if (!(await settlesWithin(running, stopWithin)).settled) failures.push(`a call stopped while it ran had not ended after ${String(stopWithin)} ms`);
  } finally {
    globalThis.fetch = ownFetch;
  }
  return { failures, reached };
}
