// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The engine's website reader: one page of a company's own site, read on a person's click, for its company
 * facts only.
 *
 * Add-on code never fetches a site somebody typed: its network is the exact hosts its manifest names, and it
 * holds the owner's keys for other services. So the engine reads, and a source is handed the typed facts.
 *
 * The rules, in order:
 * 1. The address is a name: never a literal IP, a name with a password in it, another port, or a single word.
 * 2. The site's `robots.txt` first (RFC 9309, `robots.ts`): a rule against this reader, or a server that fails
 *    to answer it, and nothing is read. A missing file (4xx) allows. Kept a day per host.
 * 3. https first; plain http on port 80 only when https cannot be connected to at all. Nothing of anyone's goes
 *    over it: no key, no cookie (this reader sends neither, ever).
 * 4. Redirects are followed only within the site: the same name, `www.` and the bare name, and http to https on
 *    it. Never https to http. A redirect to another site stops and says where (`asks`): the person may confirm
 *    that host and ask again.
 * 5. `text/html` or `application/xhtml+xml` only, at most 2 MiB, 10 s for each request.
 * 6. A page that says `noindex` (meta or `X-Robots-Tag`) or reserves text and data mining is not read.
 * 7. At most 2 reads in flight per install and 1 per site: a third waits its turn (or the person's Stop).
 * 8. Only where the operator lets this server call outside (`readerCallsOut`).
 *
 * The person sees one of four things (`refused-by-site`, `not-a-page`, `unreachable`, `asks`); why a fetch
 * failed in detail (a name that resolves to a private address, one that does not resolve) goes to the log, with
 * the host and path only. Shown, it would tell a member of staff which names exist inside the server's network.
 */
import { isIP } from 'node:net';

import type { TrialPolicy } from '../trial/policy.js';
import { decodePage, extractPage } from './extract.js';
import { createRobotsCache, parseRobots, robotsAllows, ROBOTS_MAX_BYTES, type RobotsCache, type RobotsRules } from './robots.js';
import { pin, safeFetch, SafeFetchError, type SafeFetchOptions, type SafeResponse } from './safe-fetch.js';

// ── the facts it gives (the shapes of the `lead-source@1` contract's `CompanyFacts` and `WebsitePage`) ──────────

/** What a source knows of a company, every field optional. */
export interface CompanyFacts {
  name?: string;
  number?: string;
  website?: string;
  phone?: string;
  address?: { lines?: string; town?: string; region?: string; postalCode?: string; country?: string };
  activity?: { code?: string; label?: string };
  about?: string;
  /** https only. */
  sourceUrl?: string;
}

/** One page of a company's site, as facts. */
export interface WebsitePage {
  /** The address read first. */
  url: string;
  /** The address the page came from, after redirects within the site. */
  finalUrl: string;
  name?: string;
  /** The site's own meta description, never the page's prose. */
  about?: string;
  /** JSON-LD `Organization` / `LocalBusiness` blocks, mapped; at most 5. */
  jsonLd: CompanyFacts[];
  /** Generic addresses only (`info@`, `contact@` …). */
  emails: string[];
  /** Switchboard numbers only, never a mobile; at most 2. */
  phones: string[];
  address?: CompanyFacts['address'];
}

export type WebsiteReadOutcome =
  | { outcome: 'read'; page: WebsitePage }
  /** The site asks tools not to read it (robots.txt, `noindex`, TDM reservation), or its robots.txt could not be had. */
  | { outcome: 'refused-by-site' }
  /** The answer is not a web page this reader takes (another type, too large). */
  | { outcome: 'not-a-page' }
  /** Every other failure: no such site, not public, did not answer, answered an error. */
  | { outcome: 'unreachable' }
  /** The site sends visitors to another one, `host`: read it only once the person says so. */
  | { outcome: 'asks'; host: string };

// ── the rules' numbers ──────────────────────────────────────────────────────

export const READER_USER_AGENT = 'Adminium-LeadFinder/1 (+https://adminium.dev/lead-finder)';
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;
/** The whole read, robots.txt, fallbacks and redirects included. */
export const READ_DEADLINE_MS = 30_000;
const PAGE_TYPES = ['text/html', 'application/xhtml+xml'] as const;
const MAX_PAGE_REDIRECTS = 5;
const MAX_ROBOTS_REDIRECTS = 5;
export const READS_PER_INSTALL = 2;
export const READS_PER_SITE = 1;

// ── the operator's switches ─────────────────────────────────────────────────

/**
 * Whether the reader may call outside: only where this server calls outside at all (`ADMINIUM_NETWORK_FEATURES`)
 * and the profile lets add-ons reach their hosts (off in trial mode), as the lead sources it serves. Private
 * addresses are never called, whatever `ADMINIUM_NETWORK_POLICY` says: `safeFetch` refuses them always.
 */
export function readerCallsOut(networkFeatures: boolean, policy: Pick<TrialPolicy, 'allows'>): boolean {
  return networkFeatures && policy.allows('addOnHttp').allowed;
}

// ── turns: 2 per install, 1 per site ───────────────────────────────────────

/** Counted turns per key, each waiter in line until one is given back; a waiter whose signal aborts leaves the line. */
export interface Turns {
  take(key: string, signal: AbortSignal): Promise<() => void>;
  /** For tests: how many hold a turn under `key`, and how many wait. */
  count(key: string): { holding: number; waiting: number };
}

export function createTurns(limit: number): Turns {
  const held = new Map<string, number>();
  const lines = new Map<string, (() => void)[]>();
  const giveBack = (key: string): void => {
    const next = lines.get(key)?.shift();
    if (lines.get(key)?.length === 0) lines.delete(key);
    // The turn passes straight to the first in line: the count stays as it was.
    if (next !== undefined) {
      next();
      return;
    }
    const left = (held.get(key) ?? 1) - 1;
    if (left <= 0) held.delete(key);
    else held.set(key, left);
  };
  const release = (key: string): (() => void) => {
    let given = false;
    return () => {
      if (given) return;
      given = true;
      giveBack(key);
    };
  };
  return {
    take(key, signal) {
      if (signal.aborted) return Promise.reject(signal.reason as Error);
      const holding = held.get(key) ?? 0;
      if (holding < limit) {
        held.set(key, holding + 1);
        return Promise.resolve(release(key));
      }
      return new Promise((resolve, reject) => {
        const line = lines.get(key) ?? [];
        lines.set(key, line);
        const go = (): void => {
          signal.removeEventListener('abort', leave);
          resolve(release(key));
        };
        const leave = (): void => {
          const at = line.indexOf(go);
          if (at !== -1) line.splice(at, 1);
          if (line.length === 0 && lines.get(key) === line) lines.delete(key);
          reject(signal.reason as Error);
        };
        line.push(go);
        signal.addEventListener('abort', leave, { once: true });
      });
    },
    count: (key) => ({ holding: held.get(key) ?? 0, waiting: lines.get(key)?.length ?? 0 }),
  };
}

/** What the reader keeps between reads, one per server: the robots cache and the turns. */
export interface WebsiteReaderState {
  robots: RobotsCache;
  perInstall: Turns;
  perSite: Turns;
}

export function createWebsiteReaderState(now: () => number): WebsiteReaderState {
  return { robots: createRobotsCache({ now }), perInstall: createTurns(READS_PER_INSTALL), perSite: createTurns(READS_PER_SITE) };
}

// ── names ───────────────────────────────────────────────────────────────────

/** A host in lower case with no final dot. */
const bareHost = (host: string): string => host.toLowerCase().replace(/\.$/, '');

/**
 * The site a host belongs to, as this reader counts one: the host without one leading `www.`. There is no
 * public-suffix list in this server, and none is needed for this: two hosts are one site only when they are the
 * same name or differ by `www.`, so `example.co.uk` and `www.example.co.uk` are one, and `other.co.uk` (or
 * `shop.example.co.uk`) is another site, which the person is asked about.
 */
export const siteOf = (host: string): string => bareHost(host).replace(/^www\./, '');

/** Why an address is not one this reader calls, or null when it is: a name, on the scheme's own port. */
function notAName(url: URL): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'scheme';
  if (url.username !== '' || url.password !== '') return 'userinfo';
  // `new URL` drops a port that is the scheme's default, so any port left is another one.
  if (url.port !== '') return 'port';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return 'literal-ip';
  if (!bareHost(host).includes('.') || /(?:^|\.)localhost$/.test(bareHost(host))) return 'not-a-name';
  return null;
}

/** The typed website as the https address read first; null when it is no address at all. */
export function startAddress(typed: string): URL | null {
  const text = typed.trim();
  if (text === '' || /\s/.test(text)) return null;
  // A typed `http://` is tried over https first too; a name with no scheme is a name.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hash = '';
  // http with no port of its own becomes https with none: a typed `http://name:80` too.
  if (url.protocol === 'http:') {
    const port = url.port;
    url.protocol = 'https:';
    if (port === '80') url.port = '';
  }
  return url;
}

// ── reading ─────────────────────────────────────────────────────────────────

export interface WebsiteReaderLog {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface WebsiteReaderDeps {
  state: WebsiteReaderState;
  log: WebsiteReaderLog;
  /** Asked at each read: whether the operator lets this server call outside (`readerCallsOut`). */
  outside: () => boolean;
  /** For tests only: how names resolve and how a checked address is connected to (`safeFetch`'s own seams). */
  seams?: Pick<SafeFetchOptions, 'resolve' | 'connect'> | undefined;
}

export interface WebsiteReadInput {
  /** The website as typed (a name, or an address). */
  website: string;
  /** The install the read is for: at most two reads in flight for one. */
  install: string;
  /** The person's Stop. A stopped read throws the signal's reason. */
  signal?: AbortSignal | undefined;
  /** A host the person agreed to after `asks`: a redirect to it (or to its `www.` twin) is followed. */
  confirmedHost?: string | undefined;
  /** The company's country, if known (ISO alpha-2): which numbers written without a country code are mobiles. */
  country?: string | undefined;
}

/** Why a read stopped, for the log only. */
class Stop extends Error {
  constructor(
    readonly outcome: Exclude<WebsiteReadOutcome, { outcome: 'read' }>,
    readonly why: string,
    readonly where: URL | null,
  ) {
    super(why);
  }
}

/** Where a request went, for the log: the host and the path, never the query (it can hold a person's search or a token). */
const placeOf = (url: URL | null): { host?: string; path?: string } => (url === null ? {} : { host: url.hostname, path: url.pathname });

/** What a failed fetch means to the person: the reason itself goes only to the log. */
function outcomeOfFetch(error: SafeFetchError): Exclude<WebsiteReadOutcome, { outcome: 'read' | 'asks' }> {
  if (error.reason === 'too-large' || error.reason === 'type') return { outcome: 'not-a-page' };
  return { outcome: 'unreachable' };
}

/** The path a robots rule is judged against: the path and its query. */
const pathOf = (url: URL): string => `${url.pathname}${url.search}`;

/** What `X-Robots-Tag` says to this reader: an unnamed `noindex`/`none`, or one named for Adminium. */
function headerSaysNoindex(value: string | undefined): boolean {
  if (value === undefined) return false;
  for (const part of value.split(',')) {
    const scoped = /^\s*([A-Za-z_-]+)\s*:\s*(.*)$/.exec(part);
    const directive = (scoped === null ? part : (scoped[2] ?? '')).trim().toLowerCase();
    const forUs = scoped === null || ['adminium', 'adminium-leadfinder'].includes((scoped[1] ?? '').toLowerCase());
    if (forUs && (directive === 'noindex' || directive === 'none')) return true;
  }
  return false;
}

/**
 * Reads one page of a company's website for its facts. Resolves to what the person is shown; throws only when the
 * person's own signal stopped the read (its reason).
 */
export async function readCompanyWebsite(input: WebsiteReadInput, deps: WebsiteReaderDeps): Promise<WebsiteReadOutcome> {
  const stopped = input.signal ?? new AbortController().signal;
  const start = startAddress(input.website);
  const refusedName = start === null ? 'not-an-address' : notAName(start);
  if (start === null || refusedName !== null) {
    deps.log.info({ ...placeOf(start), reason: refusedName }, 'website reader: the address is not one it reads');
    return { outcome: 'unreachable' };
  }
  if (!deps.outside()) {
    deps.log.info({ ...placeOf(start), reason: 'network-off' }, 'website reader: this server calls nothing outside');
    return { outcome: 'unreachable' };
  }
  const confirmed = input.confirmedHost === undefined || input.confirmedHost.trim() === '' ? null : siteOf(input.confirmedHost.trim());
  // Turns: the install's first, then each site's, in one order, so two reads can never wait on each other.
  const sites = [...new Set([siteOf(start.hostname), ...(confirmed === null ? [] : [confirmed])])].sort();
  const releases: (() => void)[] = [];
  try {
    releases.push(await deps.state.perInstall.take(input.install, stopped));
    for (const site of sites) releases.push(await deps.state.perSite.take(site, stopped));
    return await readTaken(start, confirmed, input, deps, stopped);
  } finally {
    for (const release of releases.reverse()) release();
  }
}

async function readTaken(start: URL, confirmed: string | null, input: WebsiteReadInput, deps: WebsiteReaderDeps, stopped: AbortSignal): Promise<WebsiteReadOutcome> {
  const deadline = AbortSignal.timeout(READ_DEADLINE_MS);
  const signal = AbortSignal.any([stopped, deadline]);
  const allowedSites = new Set([siteOf(start.hostname), ...(confirmed === null ? [] : [confirmed])]);

  const fetchOnce = async (url: URL, extra: Partial<SafeFetchOptions>): Promise<SafeResponse> => {
    try {
      return await safeFetch(url.toString(), {
        maxBytes: PAGE_MAX_BYTES,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal,
        allowHttp: true,
        redirect: 'return',
        userAgent: READER_USER_AGENT,
        ...extra,
        ...(deps.seams ?? {}),
      });
    } catch (error) {
      // The person's Stop is theirs to see; the read's own deadline is a site that took too long.
      if (stopped.aborted) throw stopped.reason;
      if (error instanceof SafeFetchError) throw error;
      if (deadline.aborted) throw new SafeFetchError('timeout', 'The site took too long to answer.');
      throw new SafeFetchError('network', error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * A host's robots.txt, as the rules for this reader. A missing file allows; a server error, a file too large
   * or a redirect off the site blocks; a site that cannot be reached at all is unreachable.
   */
  const robotsOf = async (origin: URL): Promise<RobotsRules> => {
    const key = origin.origin;
    const cached = deps.state.robots.get(key);
    if (cached !== null) return cached;
    let at = new URL('/robots.txt', origin);
    for (let hop = 0; ; hop += 1) {
      let answer: SafeResponse;
      try {
        answer = await fetchOnce(at, { maxBytes: ROBOTS_MAX_BYTES, headers: { accept: 'text/plain' } });
      } catch (error) {
        if (!(error instanceof SafeFetchError)) throw error;
        // RFC 9309: a missing file is no rule at all. 429 is read as the server asking to be left alone.
        if (error.reason === 'status' && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429) {
          const none: RobotsRules = { rules: [] };
          deps.state.robots.set(key, none);
          return none;
        }
        if (error.reason === 'status' || error.reason === 'too-large') throw new Stop({ outcome: 'refused-by-site' }, `robots-${error.reason}${error.status === undefined ? '' : `-${String(error.status)}`}`, at);
        throw new Stop(outcomeOfFetch(error), `robots-${error.reason}`, at);
      }
      if (answer.status >= 300 && answer.status < 400) {
        const next = redirectTarget(at, answer);
        if (next === null || hop >= MAX_ROBOTS_REDIRECTS || siteOf(next.hostname) !== siteOf(at.hostname) || (at.protocol === 'https:' && next.protocol !== 'https:')) {
          throw new Stop({ outcome: 'refused-by-site' }, 'robots-redirect', at);
        }
        at = next;
        continue;
      }
      const rules = parseRobots(answer.body.toString('utf8'));
      deps.state.robots.set(key, rules);
      return rules;
    }
  };

  /** Stops unless the host's robots.txt lets this reader read the path. */
  const mayRead = async (url: URL): Promise<void> => {
    if (!robotsAllows(await robotsOf(url), pathOf(url))) throw new Stop({ outcome: 'refused-by-site' }, 'robots-disallow', url);
  };

  try {
    // https first. When https cannot be connected to at all, the same name over plain http on port 80.
    let url = new URL(start);
    try {
      await mayRead(url);
    } catch (error) {
      if (!(error instanceof Stop) || error.why !== 'robots-network') throw error;
      deps.log.info({ ...placeOf(url), reason: 'https-network' }, 'website reader: https did not connect, trying http');
      url = new URL(start);
      url.protocol = 'http:';
      await mayRead(url);
    }
    for (let hop = 0; ; hop += 1) {
      let answer: SafeResponse;
      try {
        answer = await fetchOnce(url, { contentTypes: PAGE_TYPES, headers: { accept: 'text/html,application/xhtml+xml' } });
      } catch (error) {
        if (!(error instanceof SafeFetchError)) throw error;
        throw new Stop(outcomeOfFetch(error), `page-${error.reason}${error.status === undefined ? '' : `-${String(error.status)}`}`, url);
      }
      if (answer.status >= 300 && answer.status < 400) {
        const next = redirectTarget(url, answer);
        if (next === null || hop >= MAX_PAGE_REDIRECTS) throw new Stop({ outcome: 'unreachable' }, 'redirects', url);
        const refused = notAName(next);
        if (refused !== null) throw new Stop({ outcome: 'unreachable' }, `redirect-${refused}`, next);
        if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Stop({ outcome: 'unreachable' }, 'redirect-https-to-http', next);
        if (!allowedSites.has(siteOf(next.hostname))) {
          // Another site: say where, but only when it is a public one. A redirect into this server's own
          // network, or to a name that does not resolve, is a site that cannot be reached.
          try {
            await pin(next, deps.seams?.resolve, { allowHttp: true });
          } catch (error) {
            throw new Stop({ outcome: 'unreachable' }, `redirect-${error instanceof SafeFetchError ? error.reason : 'network'}`, next);
          }
          throw new Stop({ outcome: 'asks', host: bareHost(next.hostname) }, 'redirect-other-site', next);
        }
        await mayRead(next);
        url = next;
        continue;
      }
      if (headerSaysNoindex(answer.headers?.['x-robots-tag'])) throw new Stop({ outcome: 'refused-by-site' }, 'x-robots-tag', url);
      if (answer.headers?.['tdm-reservation']?.trim() === '1') throw new Stop({ outcome: 'refused-by-site' }, 'tdm-header', url);
      const { page, wishes } = extractPage(decodePage(answer.body, answer.contentType), { url: start.toString(), finalUrl: url.toString(), country: input.country ?? null });
      if (wishes.noindex) throw new Stop({ outcome: 'refused-by-site' }, 'meta-noindex', url);
      if (wishes.tdmReserved) throw new Stop({ outcome: 'refused-by-site' }, 'meta-tdm', url);
      return { outcome: 'read', page };
    }
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    deps.log.info({ ...placeOf(error.where), reason: error.why, outcome: error.outcome.outcome }, 'website reader: not read');
    return error.outcome;
  }
}

/** Where a redirect points, resolved against the address that answered; null when it points nowhere. */
function redirectTarget(from: URL, answer: SafeResponse): URL | null {
  const location = answer.headers?.['location'];
  if (location === undefined || location.trim() === '') return null;
  try {
    const next = new URL(location, from);
    next.hash = '';
    return next;
  } catch {
    return null;
  }
}
