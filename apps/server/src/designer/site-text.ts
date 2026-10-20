// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page (.html) or a stylesheet (.css) of a site template, as text a model reads.
 *
 * The person brings the template, but they did not write it: whoever did may have put "ignore your
 * rules" in a comment. So none of its text goes with the person's message. The message says how
 * large it is and how many files it names; the text itself is read a window at a time, each window
 * fenced and said to be data (`untrusted.ts`). A minified file is one long line: a window of it is
 * noise, so it is read as a summary of what it holds instead.
 *
 * A page is known by how it starts (a doctype, `<html>`, `<head>` or `<body>`, after any blank
 * space and comments), whatever its name. A stylesheet has no first bytes of its own: like a
 * Markdown document, it is known by its name, and text that starts as markup is not one.
 */
import { plainWords } from './untrusted.js';

/** The most a page may be: a template's page is markup, its pictures and scripts are files of their own. */
export const ATTACHMENT_MAX_HTML_BYTES = 512 * 1024;
/** The most a stylesheet may be: a whole framework's CSS, unminified, is under it. */
export const ATTACHMENT_MAX_CSS_BYTES = 1024 * 1024;
/** The characters of a page or stylesheet one read gives. */
export const SITE_WINDOW_CHARS = 12_000;

/** Whether a text starts as a web page: blank space and comments first are passed over. */
export function startsAsPage(text: string): boolean {
  let rest = text.replace(/^\uFEFF/, '');
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (!rest.startsWith('<!--')) break;
    const end = rest.indexOf('-->');
    if (end < 0) return false;
    rest = rest.slice(end + 3);
  }
  return /^<(?:!doctype\s+html|html|head|body)(?=[\s>/])/i.test(rest);
}

/** Whether a file's name says it is a stylesheet. */
export const isCssName = (filename: string): boolean => /\.css$/i.test(filename.trim());
/** Whether a file's name says it is a page. */
export const isHtmlName = (filename: string): boolean => /\.html?$/i.test(filename.trim());

/**
 * Whether a text is minified: longer than one window, and most of it on lines no person writes.
 * Such a file is read as a summary, not paged.
 */
export function isMinified(text: string): boolean {
  if (text.length <= SITE_WINDOW_CHARS) return false;
  const long = text.split('\n').reduce((sum, line) => sum + (line.length > 1000 ? line.length : 0), 0);
  return long * 2 > text.length;
}

/**
 * Characters of a text from `from` (counted from 1), at most `size` of them. A window that does
 * not reach the end stops at a line's end when one is near, and never between the two halves of a
 * character written as a pair.
 */
export function textWindow(text: string, from: number, size = SITE_WINDOW_CHARS): { text: string; from: number; to: number; of: number } {
  const start = Math.max(1, Math.floor(from)) - 1;
  let end = Math.min(text.length, start + size);
  if (end < text.length) {
    const line = text.lastIndexOf('\n', end - 1);
    if (line >= start + Math.floor(size * 0.8)) end = line + 1;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff && end - 1 > start) end -= 1;
  }
  return { text: text.slice(start, end), from: start + 1, to: end, of: text.length };
}

export type NamedKind = 'stylesheet' | 'script' | 'picture' | 'font' | 'page';

/** The files a page or stylesheet names: the template's own (by their paths, as written) and the other sites it loads from. */
export interface Named {
  local: { path: string; kind: NamedKind }[];
  /** The other sites it loads a file from (a font, an icon set, a script): hosts only. */
  hosts: string[];
}

const KIND_OF_EXT: Record<string, NamedKind> = {
  css: 'stylesheet',
  js: 'script',
  mjs: 'script',
  png: 'picture',
  jpg: 'picture',
  jpeg: 'picture',
  gif: 'picture',
  webp: 'picture',
  avif: 'picture',
  svg: 'picture',
  ico: 'picture',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  html: 'page',
  htm: 'page',
};

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const HTML_REF = /\s(?:href|src|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const HTML_SRCSET = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** The files a page or a stylesheet names, its own and other sites'. A page's own styles are read as a stylesheet's. */
export function namedFiles(kind: 'html' | 'css', text: string): Named {
  const refs: string[] = [];
  const take = (pattern: RegExp, each: (match: RegExpExecArray) => string[]): void => {
    for (const match of text.matchAll(pattern)) refs.push(...each(match));
  };
  take(CSS_URL, (match) => [match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '']);
  if (kind === 'html') {
    take(HTML_REF, (match) => [match[1] ?? match[2] ?? match[3] ?? '']);
    take(HTML_SRCSET, (match) => (match[1] ?? match[2] ?? '').split(',').map((part) => part.trim().split(/\s+/)[0] ?? ''));
  }
  const local = new Map<string, NamedKind>();
  const hosts = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim();
    if (ref === '' || /^(#|mailto:|tel:|javascript:|data:|blob:|about:|\{\{|\$\{)/i.test(ref)) continue;
    const outside = /^(?:https?:)?\/\/([^/?#\s]+)/i.exec(ref);
    if (outside !== null) {
      hosts.add((outside[1] ?? '').toLowerCase().replace(/:\d+$/, ''));
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;
    const path = ref.replace(/[?#].*$/, '').replace(/^\.\//, '');
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
    const named = KIND_OF_EXT[ext];
    if (named === undefined || path === '') continue;
    if (!local.has(path)) local.set(path, named);
  }
  return { local: [...local].map(([path, named]) => ({ path, kind: named })), hosts: [...hosts].filter((host) => host !== '') };
}

/** The last part of a path, as a file name is compared: lower case. */
export const lastPart = (path: string): string => (path.split(/[\\/]/).pop() ?? '').toLowerCase();

const PLURAL: Record<NamedKind, [string, string]> = {
  stylesheet: ['stylesheet', 'stylesheets'],
  script: ['script', 'scripts'],
  picture: ['picture', 'pictures'],
  font: ['font', 'fonts'],
  page: ['other page', 'other pages'],
};

/** Counts of files by kind, in words: "3 stylesheets, 12 pictures and 1 script". Empty when there are none. */
export function countWords(files: readonly { kind: NamedKind }[]): string {
  const counts = new Map<NamedKind, number>();
  for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  const parts = (['page', 'stylesheet', 'script', 'picture', 'font'] as const).flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [`${String(count)} ${PLURAL[kind][count === 1 ? 0 : 1]}`];
  });
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

const top = (values: Iterable<string>, max: number): string[] => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([value]) => value);
};

/**
 * What a minified file holds, as lines: read in its place. Every value in it is the template's
 * (a colour, a font's name, a heading's words), made one plain line each; the caller fences it.
 */
export function minifiedSummary(kind: 'html' | 'css', text: string): string {
  const lines = text.split('\n').length;
  const out = [`${String(text.length)} characters on ${String(lines)} ${lines === 1 ? 'line' : 'lines'}, minified.`];
  const styles = kind === 'css' ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '').join('\n');
  if (kind === 'html') {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
    if (title !== undefined) out.push(`title: ${plainWords(title.replace(/<[^>]*>/g, ' '), 120)}`);
    const lang = /<html[^>]*\slang\s*=\s*["']?([a-z-]{2,20})/i.exec(text)?.[1];
    if (lang !== undefined) out.push(`language: ${lang}`);
    const headings = [...text.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].slice(0, 30).map((match) => `h${match[1] ?? ''} ${plainWords((match[2] ?? '').replace(/<[^>]*>/g, ' '), 100)}`);
    if (headings.length > 0) out.push(`headings:\n${headings.map((line) => `- ${line}`).join('\n')}`);
    const count = (pattern: RegExp): number => [...text.matchAll(pattern)].length;
    out.push(`elements: about ${String(count(/<[a-z][a-z0-9-]*[\s>/]/gi))}; forms: ${String(count(/<form[\s>]/gi))}; links: ${String(count(/<a[\s>]/gi))}; pictures: ${String(count(/<img[\s>]/gi))}`);
  }
  if (styles.trim() !== '') {
    const rules = [...styles.matchAll(/\{/g)].length;
    const media = [...styles.matchAll(/@media\b/gi)].length;
    const faces = [...styles.matchAll(/@font-face\b/gi)].length;
    const custom = new Set([...styles.matchAll(/(--[a-z0-9_-]{1,60})\s*:/gi)].map((match) => (match[1] ?? '').toLowerCase())).size;
    out.push(`rules: about ${String(rules - media)}; @media blocks: ${String(media)}; @font-face: ${String(faces)}; custom properties: ${String(custom)}`);
    const colours = top(
      [...styles.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]{1,40}\)|hsla?\([^)]{1,40}\)/gi)].map((match) => match[0].toLowerCase().replace(/\s+/g, '')),
      16,
    );
    if (colours.length > 0) out.push(`colours, the most used first: ${colours.join(', ')}`);
    const fonts = top(
      [...styles.matchAll(/font-family\s*:\s*([^;}]{1,200})/gi)].map((match) => plainWords(match[1] ?? '', 80)),
      10,
    );
    if (fonts.length > 0) out.push(`font families, the most used first:\n${fonts.map((line) => `- ${line}`).join('\n')}`);
  }
  return out.join('\n');
}
