// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The company facts in one page of a company's own website.
 *
 * The page is somebody else's text, read with parse5 (the tree a browser would build), and only typed facts
 * about the company come out of it, each one plain line cut to a length (`plainWords`):
 *
 * - its name: `og:site_name`, else the name its JSON-LD gives, else the page's `<title>`;
 * - "About": the site's own `<meta name="description">`, never prose from the page's body (a page's prose is
 *   somebody's writing, and may name people);
 * - JSON-LD `Organization` / `LocalBusiness` blocks: name, site, telephone, postal address. Not their
 *   description, and nothing about the people in them (founder, employees);
 * - e-mail addresses with a generic local part only (`info@`, `contact@`, `post@` …, a closed list): never one
 *   that names somebody;
 * - telephone numbers, with mobile ranges dropped where the country is known: a mobile is a person's;
 * - whether the page asks not to be read (`<meta name="robots" content="noindex">`, TDM reservation).
 *
 * `mailto:` and `tel:` links count, as does the text a visitor sees. Scripts, styles and templates are never
 * read as text, and a `javascript:` or `data:` link is never read at all. No person is ever returned.
 */
import type { CompanyFacts, WebsitePage } from '@adminium/add-on-contracts';
import { parse } from 'parse5';

import { plainWords } from '../designer/untrusted.js';
import { attrOf, HTML_NS, isElement, type Element, type Node } from '../designer/site/dom.js';

export type { CompanyFacts, WebsitePage };

/** The local parts kept: an address for a company's front desk, never a person's. Compared in lower case. */
export const GENERIC_LOCAL_PARTS: readonly string[] = [
  'info', 'contact', 'contacts', 'hello', 'post', 'postmottak', 'firmapost', 'office', 'enquiries', 'enquiry', 'inquiries',
  'sales', 'mail', 'kontakt', 'bonjour', 'accueil', 'reception', 'studio', 'team', 'support', 'service', 'kundeservice',
  'buero', 'kancelar', 'kontor',
];

/** How long each kept fact may be, in characters. */
export const FACT_LIMITS = { name: 200, about: 500, website: 200, phone: 40, email: 254, lines: 200, town: 100, region: 100, postalCode: 20 } as const;

const MAX_EMAILS = 3;
const MAX_PHONES = 2;
const MAX_JSON_LD = 5;
/** JSON-LD objects looked at across the page, so a page of a million nested objects is not walked. */
const MAX_JSON_LD_NODES = 200;

/** Text that is never shown to a visitor, so never read as the page's words (nor is anything inside SVG or MathML). */
const NOT_TEXT = new Set(['script', 'style', 'template', 'noscript', 'head']);

/** The JSON-LD types read as the company: an organisation, and the few kinds of one a small business says it is. */
const COMPANY_TYPES = new Set(['organization', 'corporation', 'localbusiness', 'professionalservice']);

/** What a page says of itself besides its facts: whether it asks not to be read. */
export interface PageWishes {
  noindex: boolean;
  tdmReserved: boolean;
}

/** The country a number belongs to, where it can be told. */
type Country = 'GB' | 'FR' | 'NO';

// ── decoding ────────────────────────────────────────────────────────────────

const charsetIn = (text: string): string | null => /charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]+)/i.exec(text)?.[1]?.toLowerCase() ?? null;

/** The page's text: by its byte-order mark, else the header's charset, else its own `<meta charset>`, else UTF-8. */
export function decodePage(bytes: Buffer, contentType: string): string {
  let label: string | null = null;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = 'utf-8';
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  label ??= charsetIn(contentType);
  if (label === null) {
    // A browser looks for the page's own `<meta charset>` in its first 1024 bytes; a meta that says UTF-16 means UTF-8.
    const head = /<meta[^>]*charset[^>]*>/i.exec(bytes.subarray(0, 1024).toString('latin1'))?.[0];
    const said = head === undefined ? null : charsetIn(head);
    label = said !== null && said.startsWith('utf-16') ? 'utf-8' : said;
  }
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    // A charset this runtime does not know: read as UTF-8, with anything that is not shown as a replacement mark.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ── e-mail addresses ────────────────────────────────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;

/** The address in lower case when its local part is a generic one, else null. */
export function genericAddress(raw: string): string | null {
  const address = raw.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0 || address.length > FACT_LIMITS.email) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(domain)) return null;
  return GENERIC_LOCAL_PARTS.includes(local) ? address : null;
}

/** The addresses of a `mailto:` link, before any `?subject=`. */
function mailtoAddresses(href: string): string[] {
  const list = href.slice('mailto:'.length).split('?')[0] ?? '';
  let decoded = list;
  try {
    decoded = decodeURIComponent(list);
  } catch {
    // A broken escape: read as written.
  }
  return decoded.split(',').map((one) => one.trim());
}

// ── telephone numbers ───────────────────────────────────────────────────────

/** A run of digits a visitor would read as a number: at least eight digits, with spaces, dots, dashes or brackets between. */
const PHONE = /(?:\+|00)?\(?\d[\d \u00a0.()-]{6,22}\d/g;
/** The words that say a number after them is a telephone number. */
const PHONE_LABEL = /(?:tel|tél|phone|telephone|téléphone|telefon|tlf|ring|call|appel)[^\d+]{0,6}$/i;

const PREFIXES: Record<string, Country> = { '44': 'GB', '33': 'FR', '47': 'NO' };

/** A number's country and its digits without country code or trunk zero, where they can be told. */
function nationalOf(raw: string, known: Country | null): { country: Country | null; digits: string } {
  const plain = raw.replace(/\(0\)/g, '');
  const international = /^\s*(?:\+|00)/.test(plain);
  let digits = plain.replace(/\D/g, '');
  if (international) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    const prefix = Object.keys(PREFIXES).find((code) => digits.startsWith(code));
    // A country code this reader has no ranges for: the country is known, and it is none of these.
    if (prefix === undefined) return { country: null, digits };
    return { country: PREFIXES[prefix] ?? null, digits: digits.slice(prefix.length).replace(/^0/, '') };
  }
  if (known === 'GB' || known === 'FR') return { country: known, digits: digits.replace(/^0/, '') };
  return { country: known, digits };
}

/**
 * Whether a number is in a country's mobile range: a person's own phone, not
 * a switchboard. A number written with a country code this reader has no
 * ranges for (`+49 171 …`) cannot be judged, so it is read as one: never kept.
 */
export function isMobile(raw: string, known: Country | null): boolean {
  if (/^\s*(?:\+|00)/.test(raw.replace(/\(0\)/g, ''))) {
    const digits = raw.replace(/\D/g, '').replace(/^00/, '');
    if (!Object.keys(PREFIXES).some((code) => digits.startsWith(code))) return true;
  }
  const { country, digits } = nationalOf(raw, known);
  if (country === 'GB') return digits.startsWith('7');
  if (country === 'FR') return digits.length === 9 && (digits.startsWith('6') || digits.startsWith('7'));
  if (country === 'NO') return digits.length === 8 && (digits.startsWith('4') || digits.startsWith('9'));
  return false;
}

/** The number as one key, so the same number written twice is kept once. */
const phoneKey = (raw: string, known: Country | null): string => {
  const { country, digits } = nationalOf(raw, known);
  return `${country ?? '?'}:${digits}`;
};

/** The numbers in a visitor's text that read as telephone numbers. */
function phonesInText(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PHONE)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/g, '');
    const before = text.slice(Math.max(0, (match.index ?? 0) - 20), match.index ?? 0);
    const international = /^(?:\+|00)/.test(raw) && digits.length >= 9 && digits.length <= 15;
    const trunk = digits.startsWith('0') && digits.length >= 9 && digits.length <= 12;
    const labelled = PHONE_LABEL.test(before) && digits.length >= 8 && digits.length <= 12;
    if (international || trunk || labelled) found.push(raw);
  }
  return found;
}

// ── JSON-LD ─────────────────────────────────────────────────────────────────

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const typesOf = (node: Record<string, Json>): string[] => {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((one): one is string => typeof one === 'string').map((one) => one.replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, '').toLowerCase());
};

const textField = (value: Json | undefined, max: number): string | undefined => {
  const raw = Array.isArray(value) ? value.filter((one) => typeof one === 'string').join(', ') : value;
  if (typeof raw !== 'string') return undefined;
  const clean = plainWords(raw, max);
  return clean === '' ? undefined : clean;
};

/** A site address as written, http or https, cut to its column; anything else (a `javascript:` one) is no address. */
function siteAddress(raw: Json | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return undefined;
    const text = url.toString();
    return text.length <= FACT_LIMITS.website ? text : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON-LD postal address as the company's address: its lines, town, region, postal code and two-letter country. */
function postalAddress(raw: Json | undefined): CompanyFacts['address'] | undefined {
  if (typeof raw === 'string') {
    const lines = textField(raw, FACT_LIMITS.lines);
    return lines === undefined ? undefined : { lines };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const countryRaw = raw['addressCountry'];
  const countryText = typeof countryRaw === 'string' ? countryRaw : countryRaw !== null && typeof countryRaw === 'object' && !Array.isArray(countryRaw) ? countryRaw['name'] : undefined;
  const country = typeof countryText === 'string' && /^[A-Za-z]{2}$/.test(countryText.trim()) ? countryText.trim().toUpperCase() : undefined;
  const address: NonNullable<CompanyFacts['address']> = {};
  const lines = textField(raw['streetAddress'], FACT_LIMITS.lines);
  const town = textField(raw['addressLocality'], FACT_LIMITS.town);
  const region = textField(raw['addressRegion'], FACT_LIMITS.region);
  const postalCode = textField(raw['postalCode'], FACT_LIMITS.postalCode);
  if (lines !== undefined) address.lines = lines;
  if (town !== undefined) address.town = town;
  if (region !== undefined) address.region = region;
  if (postalCode !== undefined) address.postalCode = postalCode;
  if (country !== undefined) address.country = country;
  return Object.keys(address).length === 0 ? undefined : address;
}

/** Every object in the JSON-LD blocks, top level, `@graph` and nested, up to a bound; walked with a list, not by recursion. */
function jsonLdObjects(blocks: readonly string[]): Record<string, Json>[] {
  const out: Record<string, Json>[] = [];
  const stack: Json[] = [];
  for (const block of [...blocks].reverse()) {
    try {
      stack.push(JSON.parse(block) as Json);
    } catch {
      // A block that is not JSON says nothing.
    }
  }
  let seen = 0;
  while (stack.length > 0 && seen < MAX_JSON_LD_NODES) {
    const at = stack.pop();
    if (at === null || at === undefined || typeof at !== 'object') continue;
    if (Array.isArray(at)) {
      for (let k = at.length - 1; k >= 0; k -= 1) stack.push(at[k] as Json);
      continue;
    }
    seen += 1;
    out.push(at);
    const children = Object.values(at).filter((value) => value !== null && typeof value === 'object');
    for (let k = children.length - 1; k >= 0; k -= 1) stack.push(children[k] as Json);
  }
  return out;
}

// ── the page ────────────────────────────────────────────────────────────────

/** The country a site's own name says it is in, where its top-level domain says one. */
const countryOfHost = (host: string): Country | null => (/\.uk$/i.test(host) ? 'GB' : /\.fr$/i.test(host) ? 'FR' : /\.no$/i.test(host) ? 'NO' : null);

const asCountry = (value: string | null | undefined): Country | null => {
  const upper = value?.toUpperCase();
  return upper === 'GB' || upper === 'UK' ? 'GB' : upper === 'FR' ? 'FR' : upper === 'NO' ? 'NO' : null;
};

/** What a robots-like directive list says: `noindex` or `none`. */
const saysNoindex = (content: string): boolean => content.split(',').some((one) => ['noindex', 'none'].includes(one.trim().toLowerCase()));

/**
 * The facts of one page. `country` is what the caller knows of the company's country (ISO alpha-2), if anything:
 * it tells which numbers are mobiles when a number is written without its country code.
 */
export function extractPage(html: string, at: { url: string; finalUrl: string; country?: string | null }): { page: WebsitePage; wishes: PageWishes } {
  const document = parse(html);
  const metas = new Map<string, string>();
  const ldBlocks: string[] = [];
  const hrefs: string[] = [];
  const texts: string[] = [];
  let title: string | null = null;
  let noindex = false;
  let tdmReserved = false;

  // One walk over the tree, with a list of its own (a page nested very deep cannot run the stack out).
  const stack: { node: Node; shown: boolean }[] = [{ node: document as Node, shown: true }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, shown } = item;
    if (node.nodeName === '#text' && 'value' in node) {
      if (shown) texts.push(node.value);
      continue;
    }
    if (!('childNodes' in node)) continue;
    let childrenShown = shown;
    if (isElement(node) && node.namespaceURI !== HTML_NS) childrenShown = false;
    else if (isElement(node)) {
      const el: Element = node;
      if (NOT_TEXT.has(el.tagName)) childrenShown = false;
      if (el.tagName === 'meta') {
        const name = (attrOf(el, 'name') ?? attrOf(el, 'property') ?? '').trim().toLowerCase();
        const content = attrOf(el, 'content') ?? '';
        if (name !== '' && !metas.has(name)) metas.set(name, content);
        if (['robots', 'adminium', 'adminium-leadfinder'].includes(name) && saysNoindex(content)) noindex = true;
        if (name === 'tdm-reservation' && content.trim() === '1') tdmReserved = true;
      } else if (el.tagName === 'title' && title === null) {
        title = el.childNodes.map((child) => ('value' in child && child.nodeName === '#text' ? child.value : '')).join('');
      } else if (el.tagName === 'script') {
        // A script is code, never read; JSON-LD is data, read only as JSON.
        if ((attrOf(el, 'type') ?? '').trim().toLowerCase() === 'application/ld+json') {
          ldBlocks.push(el.childNodes.map((child) => ('value' in child && child.nodeName === '#text' ? child.value : '')).join(''));
        }
        continue;
      } else if (el.tagName === 'a' || el.tagName === 'area') {
        const href = (attrOf(el, 'href') ?? '').trim();
        if (/^(?:mailto|tel):/i.test(href)) hrefs.push(href);
      }
    }
    for (let k = node.childNodes.length - 1; k >= 0; k -= 1) {
      const child = node.childNodes[k];
      if (child !== undefined) stack.push({ node: child, shown: childrenShown });
    }
  }
  // Text nodes are joined with a space: the end of one paragraph and the start of the next never run into one word.
  const text = texts.join(' ');

  const host = (() => {
    try {
      return new URL(at.finalUrl).hostname;
    } catch {
      return '';
    }
  })();
  const sourceUrl = at.finalUrl.startsWith('https://') && at.finalUrl.length <= FACT_LIMITS.website ? at.finalUrl : undefined;

  const jsonLd: CompanyFacts[] = [];
  const ldEmails: string[] = [];
  const ldPhones: string[] = [];
  for (const node of jsonLdObjects(ldBlocks)) {
    if (jsonLd.length >= MAX_JSON_LD) break;
    if (!typesOf(node).some((type) => COMPANY_TYPES.has(type))) continue;
    const name = textField(node['name'], FACT_LIMITS.name);
    const website = siteAddress(node['url']);
    const phone = textField(node['telephone'], FACT_LIMITS.phone);
    const address = postalAddress(node['address']);
    if (typeof node['email'] === 'string') ldEmails.push(node['email'].replace(/^mailto:/i, ''));
    const facts: CompanyFacts = {
      ...(name === undefined ? {} : { name }),
      ...(website === undefined ? {} : { website }),
      ...(phone === undefined ? {} : { phone }),
      ...(address === undefined ? {} : { address }),
    };
    if (Object.keys(facts).length === 0) continue;
    if (phone !== undefined) ldPhones.push(phone);
    jsonLd.push(sourceUrl === undefined ? facts : { ...facts, sourceUrl });
  }
  const address = jsonLd.find((facts) => facts.address !== undefined)?.address;
  const country = asCountry(at.country) ?? asCountry(address?.country) ?? countryOfHost(host);

  // A mobile in a JSON-LD block is a person's phone too: it leaves the block as it leaves the page.
  for (const facts of jsonLd) if (facts.phone !== undefined && isMobile(facts.phone, country)) delete facts.phone;

  const emails: string[] = [];
  for (const raw of [...hrefs.filter((href) => /^mailto:/i.test(href)).flatMap(mailtoAddresses), ...ldEmails, ...[...text.matchAll(EMAIL)].map((match) => match[0])]) {
    const address = genericAddress(raw);
    if (address !== null && !emails.includes(address) && emails.length < MAX_EMAILS) emails.push(address);
  }

  const phones: string[] = [];
  const phoneKeys = new Set<string>();
  const telLinks = hrefs.filter((href) => /^tel:/i.test(href)).map((href) => {
    try {
      return decodeURIComponent(href.slice(4));
    } catch {
      return href.slice(4);
    }
  });
  for (const raw of [...telLinks, ...ldPhones, ...phonesInText(text)]) {
    const clean = plainWords(raw, FACT_LIMITS.phone);
    const digits = clean.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15 || isMobile(clean, country)) continue;
    const key = phoneKey(clean, country);
    if (phoneKeys.has(key) || phones.length >= MAX_PHONES) continue;
    phoneKeys.add(key);
    phones.push(clean);
  }

  const siteName = metas.get('og:site_name');
  const titleText = title as string | null;
  const nameRaw = siteName !== undefined && plainWords(siteName, FACT_LIMITS.name) !== '' ? siteName : (jsonLd.find((facts) => facts.name !== undefined)?.name ?? titleText ?? '');
  const name = plainWords(nameRaw, FACT_LIMITS.name);
  const about = plainWords(metas.get('description') ?? '', FACT_LIMITS.about);

  const page: WebsitePage = {
    url: at.url,
    finalUrl: at.finalUrl,
    ...(name === '' ? {} : { name }),
    ...(about === '' ? {} : { about }),
    jsonLd,
    emails,
    phones,
    ...(address === undefined ? {} : { address }),
  };
  return { page, wishes: { noindex, tdmReserved } };
}
