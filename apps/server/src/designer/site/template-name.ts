// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The business a site template names, read from its pages' titles.
 *
 * A new app is named first, before the model has read anything of the template: from a zip it knows only the
 * request ("Make an app from it") and named the app after itself ("Site Studio"), though every page of the
 * template said whose site it was ("… — Fernhill Ceramics"). The titles are the template's words, so they never
 * ride in the system prompt: `name_app` hands them over once, as data, when the name it was given has nothing to
 * do with them or with what the person wrote.
 */
import type { Attachments } from '../attachments.js';
import { plainWords } from '../untrusted.js';

/** The pages read for their titles, and how much of each. */
const PAGES_MAX = 12;
const HEAD_BYTES = 16 * 1024;
const TITLE_MAX = 80;

const ENTITY: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** A page's <title>, as a person reads it; null when it has none. */
export function titleOf(html: string): string | null {
  const found = /<title\b[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html.slice(0, HEAD_BYTES));
  if (found === null) return null;
  const read = (found[1] as string).replace(/&(?:([a-z]{2,4})|#(\d{1,7}));/gi, (all, name: string | undefined, decimal: string | undefined) => {
    if (name !== undefined) return ENTITY[name.toLowerCase()] ?? all;
    const code = Number(decimal);
    return code >= 32 && code <= 0xffff && !(code >= 0x7f && code < 0xa0) && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
  const title = plainWords(read.replace(/<[^>]*>/g, ' '), TITLE_MAX);
  return title === '' ? null : title;
}

/** The titles of the templates a session holds: a site's pages, and each page attached by itself. */
export function templateTitles(attachments: Attachments, sessionId: string): string[] {
  const titles: string[] = [];
  const take = (bytes: Buffer | null | undefined): void => {
    if (bytes === null || bytes === undefined || titles.length >= PAGES_MAX) return;
    const title = titleOf(bytes.subarray(0, HEAD_BYTES).toString('utf8'));
    if (title !== null) titles.push(title);
  };
  for (const entry of attachments.list(sessionId)) {
    if (entry.kind === 'html') take(attachments.read(sessionId, entry.id));
    else if (entry.kind === 'site') {
      const pages = (attachments.siteFiles(sessionId, entry.id)?.files ?? []).filter((file) => file.kind === 'html');
      for (const page of pages.slice(0, PAGES_MAX)) take(attachments.siteFile(sessionId, entry.id, page.path)?.bytes);
    }
  }
  return titles;
}

/** A title's words, bare: the marks around them off, the ones that are only marks (a dash, a bar) left out. */
const wordsOf = (text: string): string[] =>
  text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((word) => word !== '');

/**
 * The name the titles agree on: a whole part of a title ("Shop — Fernhill Ceramics" has two) that stands, as a whole
 * part, in at least half of them, and in two at least. Null when they agree on none: one page, or titles that share
 * no part ("About", "About too"), name no business for certain, and then nothing is said.
 */
export function nameInTitles(titles: readonly string[]): string | null {
  if (titles.length < 2) return null;
  const count = new Map<string, { name: string; titles: Set<number> }>();
  titles.forEach((title, at) => {
    for (const part of title.split(/\s+[-–—|·:•]+\s+|[|·•]/)) {
      const words = wordsOf(part);
      // A name is a few words with letters in them; a part cut short by the title's own length is not a whole part.
      if (words.length === 0 || words.length > 4 || part.trimEnd().endsWith('…') || !/\p{L}{3}/u.test(part)) continue;
      const name = words.join(' ');
      const kept = count.get(name.toLowerCase()) ?? { name, titles: new Set<number>() };
      kept.titles.add(at);
      count.set(name.toLowerCase(), kept);
    }
  });
  const needed = Math.max(2, Math.ceil(titles.length / 2));
  const agreed = [...count.values()].filter((entry) => entry.titles.size >= needed).sort((a, b) => b.titles.size - a.titles.size || b.name.length - a.name.length);
  return agreed[0]?.name ?? null;
}

/** Words that name no business: the request's own, and the tool's. */
const EMPTY_WORDS = new Set(['app', 'apps', 'site', 'sites', 'website', 'websites', 'web', 'page', 'pages', 'template', 'templates', 'make', 'made', 'build', 'from', 'the', 'and', 'for', 'with', 'this', 'that', 'new', 'studio', 'designer', 'adminium']);

/**
 * Whether a name is the business the template names, or one the person asked for. It is the business's when it is
 * its name, a short form of it ("Fernhill" for "Fernhill Ceramics") or its name with a word more ("Fernhill Ceramics
 * Shop"). One word in common is not enough: "Fernhill Pottery" for a template that says "Fernhill Ceramics" is half
 * the model's own (seen 2026-11-27). It is the person's when a word of it, of three letters or more, is in what they
 * wrote (the request's own words, "app", "site", "template", name nothing).
 */
export function nameFits(name: string, business: string, personWords: string): boolean {
  const mine = wordsOf(name.toLowerCase());
  const theirs = wordsOf(business.toLowerCase());
  if (mine.length > 0 && theirs.length > 0 && (mine.every((word) => theirs.includes(word)) || theirs.every((word) => mine.includes(word)))) return true;
  const said = new Set(wordsOf(personWords.toLowerCase()));
  return mine.some((word) => word.length >= 3 && !EMPTY_WORDS.has(word) && said.has(word));
}
