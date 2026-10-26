// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DNS checks for a sender: is the DKIM key published, and what does the
 * domain's DMARC record say.
 *
 * ─── The TXT lookup ────────────────────────────────────────────────────────
 * `node:dns/promises` with a time limit (the resolver's own, and a timer
 * around it in case it does not keep it) and a short cache, so the settings
 * screen's "Check again" and a send's checks do not ask the network each
 * time. "No such name" and "no TXT record" are answers (an empty list); a
 * timeout or a failing server is not, and is thrown as `DnsCheckError`, so a
 * screen can say "could not check" rather than "not found". The resolver is
 * injectable for tests.
 *
 * ─── The organisational domain, without a public-suffix list ──────────────
 * DMARC's relaxed alignment asks whether two domains share an organisational
 * domain. RFC 7489 finds it with the Public Suffix List; the IETF's revision
 * of DMARC (DMARCbis) replaces the list with a "DNS tree walk": ask
 * `_dmarc.<name>` for the domain and each parent (at most 8 asks), and read
 * the records' `psd=` tags:
 *   - a record with `psd=n` marks its domain as the organisational domain;
 *   - a record with `psd=y` marks a public suffix: the organisational domain
 *     is the name one label below it;
 *   - otherwise it is the domain with the fewest labels that has a record;
 *   - and with no record at all, the domain itself.
 * This needs no shipped list (which goes stale) and no new dependency, and it
 * answers exactly the question DMARC receivers will ask. One guard: a
 * single-label name (a top-level domain) is never taken as an organisational
 * domain unless its own record says `psd=n`, so a top-level domain's own
 * record can never make two strangers' domains "aligned".
 */
import { Resolver } from 'node:dns/promises';

/** The TXT records at a name, each record's strings as DNS gives them. */
export type TxtResolver = (name: string) => Promise<string[][]>;

/** A TXT lookup: each record's strings joined, as DKIM and DMARC read them. */
export type TxtLookup = (name: string) => Promise<string[]>;

export class DnsCheckError extends Error {
  override readonly name = 'DnsCheckError';
  constructor(
    readonly reason: 'timeout' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CACHE_MS = 60_000;
const CACHE_MAX = 500;
/** Codes that mean "nothing there", which is an answer. */
const EMPTY_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NOTFOUND', 'NODATA']);

export interface TxtLookupOptions {
  resolve?: TxtResolver;
  timeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}

export function createTxtLookup(options: TxtLookupOptions = {}): TxtLookup {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const now = options.now ?? Date.now;
  const resolve =
    options.resolve ??
    ((): TxtResolver => {
      const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
      return (name) => resolver.resolveTxt(name);
    })();
  const cache = new Map<string, { records: string[]; until: number }>();

  return async (rawName) => {
    const name = rawName.trim().toLowerCase().replace(/\.$/, '');
    const kept = cache.get(name);
    if (kept !== undefined && kept.until > now()) return kept.records;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new DnsCheckError('timeout', `DNS did not answer for ${name} in time.`)), timeoutMs);
    });
    let records: string[];
    try {
      records = (await Promise.race([resolve(name), timeout])).map((parts) => parts.join(''));
    } catch (error) {
      if (error instanceof DnsCheckError) throw error;
      const code = (error as { code?: unknown }).code;
      if (typeof code !== 'string' || !EMPTY_CODES.has(code)) throw new DnsCheckError('failed', `DNS could not be asked about ${name}.`);
      records = [];
    } finally {
      clearTimeout(timer);
    }
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(name, { records, until: now() + cacheMs });
    return records;
  };
}

/** A DKIM or DMARC record's tags (`v=DKIM1; k=rsa; p=…`), names in lower case. */
export function tagsOf(record: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of record.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    if (name.length > 0 && !tags.has(name)) tags.set(name, part.slice(eq + 1).trim());
  }
  return tags;
}

/** Whether a DKIM key is published: found, a different key under the selector, or nothing there. */
export type DkimDnsState = 'found' | 'other-key' | 'not-found';

/** The DKIM record's name. */
export function dkimRecordName(domain: string, selector: string): string {
  return `${selector}._domainkey.${domain.trim().toLowerCase().replace(/\.$/, '')}`;
}

/** Whether `<selector>._domainkey.<domain>` publishes `publicKey` (base64 of its DER). */
export async function dkimFound(lookup: TxtLookup, domain: string, selector: string, publicKey: string): Promise<DkimDnsState> {
  const records = await lookup(dkimRecordName(domain, selector));
  const want = publicKey.replace(/\s+/g, '');
  let any = false;
  for (const record of records) {
    const tags = tagsOf(record);
    const version = tags.get('v');
    if (version !== undefined && version !== 'DKIM1') continue;
    const kind = tags.get('k') ?? 'rsa';
    const p = tags.get('p');
    if (p === undefined || kind.toLowerCase() !== 'rsa') continue;
    any = true;
    if (p.replace(/\s+/g, '') === want) return 'found';
  }
  return any ? 'other-key' : 'not-found';
}

export type DmarcPolicy = 'none' | 'quarantine' | 'reject';

export interface DmarcResult {
  /** The policy that applies to the domain; null when it has none. */
  policy: DmarcPolicy | null;
  /** The name whose `_dmarc` record gave the policy; null when none did. */
  recordDomain: string | null;
  /** The organisational domain (see the header). */
  orgDomain: string;
  /** Relaxed DKIM alignment: the two domains share the organisational domain. */
  aligned(fromDomain: string, dkimDomain: string): boolean;
}

interface DmarcRecord {
  name: string;
  tags: Map<string, string>;
}

const clean = (domain: string): string => domain.trim().toLowerCase().replace(/\.$/, '');
const labelsOf = (domain: string): string[] => clean(domain).split('.').filter((label) => label.length > 0);
const isUnder = (domain: string, parent: string): boolean => domain === parent || domain.endsWith(`.${parent}`);

/** The one valid DMARC record at `_dmarc.<name>`; null when there is none, or more than one (which counts as none). */
async function dmarcRecordAt(lookup: TxtLookup, name: string): Promise<DmarcRecord | null> {
  const records = (await lookup(`_dmarc.${name}`)).filter((record) => /^v\s*=\s*DMARC1\s*(;|$)/i.test(record.trim()));
  return records.length === 1 ? { name, tags: tagsOf(records[0] as string) } : null;
}

/** The names the tree walk asks, from the domain up: at most 8, skipping to 7 labels for a very long name. */
export function treeWalkNames(domain: string): string[] {
  const labels = labelsOf(domain);
  const names = [labels.join('.')];
  let count = labels.length > 8 ? 7 : labels.length - 1;
  while (count >= 1) {
    names.push(labels.slice(labels.length - count).join('.'));
    count -= 1;
  }
  return names;
}

/** A tag's value as a policy, or null when it is not one. */
const policyOf = (value: string | undefined): DmarcPolicy | null => {
  const lower = value?.toLowerCase();
  return lower === 'none' || lower === 'quarantine' || lower === 'reject' ? lower : null;
};

/** The policy a record gives the domain asked about: its own `p=`, or for a subdomain `sp=` before `p=`. */
function policyFor(record: DmarcRecord, domain: string): DmarcPolicy | null {
  const own = record.name === domain;
  const policy = own ? policyOf(record.tags.get('p')) : (policyOf(record.tags.get('sp')) ?? policyOf(record.tags.get('p')));
  // RFC 7489 section 6.6.3: a record with a missing or bad `p=` that asks for reports is read as `none`.
  if (policy === null && record.tags.has('rua')) return 'none';
  return policy;
}

/** What DMARC says about a domain: its policy, its organisational domain, and alignment. */
export async function dmarcOf(lookup: TxtLookup, rawDomain: string): Promise<DmarcResult> {
  const domain = clean(rawDomain);
  const names = treeWalkNames(domain);
  const found: DmarcRecord[] = [];
  for (const name of names) {
    const record = await dmarcRecordAt(lookup, name);
    if (record !== null) found.push(record);
  }

  // The policy: the first record up the walk (the domain's own, else its nearest parent's).
  const first = found[0] ?? null;
  const policy = first === null ? null : policyFor(first, domain);

  // The organisational domain.
  let orgDomain: string | null = null;
  for (const record of found) {
    const psd = record.tags.get('psd')?.toLowerCase();
    if (psd === 'n') {
      orgDomain = record.name;
      break;
    }
    if (psd === 'y') {
      const below = labelsOf(record.name).length + 1;
      const labels = labelsOf(domain);
      orgDomain = labels.length >= below ? labels.slice(labels.length - below).join('.') : domain;
      break;
    }
  }
  if (orgDomain === null) {
    const candidates = found.filter((record) => labelsOf(record.name).length >= 2);
    orgDomain = candidates.length > 0 ? (candidates[candidates.length - 1] as DmarcRecord).name : domain;
  }
  const org = orgDomain;

  return {
    policy,
    recordDomain: first?.name ?? null,
    orgDomain: org,
    aligned(fromDomain, dkimDomain) {
      const from = clean(fromDomain);
      const dkim = clean(dkimDomain);
      if (from === dkim) return true;
      return isUnder(from, org) && isUnder(dkim, org);
    },
  };
}
