// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY HOST AN EMAIL CAN SEND A PERSON TO, OR LOAD FROM.
 *
 * An email a file brings is read before it is applied, so the person applying
 * it can see each outside host it names and tick them one by one. That only
 * means something if the reading finds every host the mail client would find.
 * So nothing here matches `https://` by eye:
 *
 *  - an `email.html` block's code is parsed as a browser parses it (parse5,
 *    scripting off, so `<noscript>` holds markup), entities decoded, and every
 *    element, attribute, `style`, `<style>` sheet, `<meta>` refresh, comment
 *    (Outlook's `<!--[if mso]>` holds markup) and `srcdoc` is read;
 *  - a value that names an address is read by the WHATWG URL parser, the one
 *    browsers use, so `https:/evil`, `https:\\evil`, `https:evil`, `//evil`,
 *    `\\evil`, a percent-encoded or full-width dot, a tab inside the scheme all
 *    come out as the host a browser would go to;
 *  - words that are not markup are read for what a mail client links on its
 *    own: `https://…`, and a bare `evil.example`;
 *  - each value is also read with its entities and its percent escapes
 *    decoded, in case a reader decodes once more than the renderer does.
 *
 * A placeholder (`{{name}}`) is filled when the mail is sent. The links an
 * email names for this server (`{{resetUrl}}`) are this server's own; every
 * other value could be anything, so an address is tried with a few hostile
 * stand-ins in its place: when the host moves with them, the host is the
 * value's to choose and cannot be told now. A backup (`{{name|words}}`) is
 * read as written too.
 *
 * What cannot be told is a PROBLEM, never a guess: an address whose host is
 * filled in later, a kind of address an email has no business linking to
 * (`javascript:`, `data:`), a script, an event handler, a style that runs
 * code, one of this server's own links handed to an outside host. A caller
 * refuses the email over any problem.
 */
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import { placeholdersIn } from '@adminium/manifest';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/** What a relative address is read against: a host nothing can name. */
const BASE_HOST = 'adminium-base.invalid';
const BASE = `https://${BASE_HOST}/`;
/** This server, as a stand-in for one of its own links. Origin only: the worst case for what follows it. */
const SELF_HOST = 'adminium-self.invalid';
const SELF = `https://${SELF_HOST}`;
/** A value filled in when the mail is sent, as the words of a text see it. */
const VAR = 'zzadminiumvarzz';
const PROBE_HOST = 'adminium-probe.invalid';
/** What a value filled in later might hold, to see whether the host moves with it. */
const PROBES = [`//${PROBE_HOST}/`, `https://${PROBE_HOST}/`, `@${PROBE_HOST}/`, `.${PROBE_HOST}/`, `\\\\${PROBE_HOST}/`, `:@${PROBE_HOST}/`, 'javascript:x'];
/** Hosts of the stand-ins, never a real one. */
const STAND_INS = [BASE_HOST, SELF_HOST, PROBE_HOST];

/** The kinds of address an email may link to or load from. */
const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'cid:', 'tel:']);

/** Attributes that hold one address. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'background',
  'poster',
  'cite',
  'longdesc',
  'usemap',
  'data',
  'codebase',
  'lowsrc',
  'dynsrc',
  'profile',
  'manifest',
  'icon',
  'itemtype',
  'itemid',
  'classid',
]);
/** Attributes that hold several, each the first word of a comma-separated part (`srcset`) or each word (`ping`). */
const LIST_ATTRIBUTES: ReadonlySet<string> = new Set(['srcset', 'imagesrcset']);
const WORD_ATTRIBUTES: ReadonlySet<string> = new Set(['ping', 'archive']);
/** Elements that run code. */
const CODE_ELEMENTS: ReadonlySet<string> = new Set(['script', 'applet']);
/** A field of a block that is an address however it is drawn. */
const LINK_FIELD = /^(?:url|href|src|link)$/i;
/** Fields that say how a mail is built, never words or an address it shows: `email.text`, a table's name. */
const STRUCTURE: ReadonlySet<string> = new Set(['block', 'id', 'fileId', 'showWhen', 'style', 'key', 'kind', 'category', 'vars', 'attach', 'attachments', 'mark', 'accent', 'from', 'joins', 'section', 'withAttachment', 'icon', 'level', 'height', 'size', 'required', 'line']);
/** How deep markup inside markup (a comment, a `srcdoc`) is read before it is refused. */
const MAX_DEPTH = 4;

/** A bare domain as a mail client links it: labels joined by dots, a top label of letters; not a step of a path or a query. */
const DOMAIN = /(?<![\p{L}\p{N}_.\-/\\=?&#%])(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+(?:xn--[a-z0-9-]+|\p{L}{2,63})(?![\p{L}\p{N}_-])/giu;
/** An IPv4 address on its own. */
const IPV4 = /(?<![\d./\\=?&#%])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
/** The start of an address with a scheme a mail client links in words. */
const SCHEME_IN_WORDS = /(?:https?|ftp)\s*:/gi;

export interface EmailLinks {
  /** Every outside host, lower case, once, sorted. */
  hosts: string[];
  /** The outside hosts a value filled in when the mail is sent rides to. */
  carried: string[];
  /** Why some address in it cannot be told, or may not be there at all; empty when every one was read. */
  problems: string[];
}

interface Collector {
  self: ReadonlySet<string>;
  hosts: Set<string>;
  carried: Set<string>;
  problems: Set<string>;
}

/** What one address reads as. */
interface Read {
  scheme: string | null;
  hosts: string[];
  /** Why it cannot be read at all. */
  bad?: string;
}

const NOTHING: Read = { scheme: null, hosts: [] };

function shown(value: string): string {
  const one = value.replaceAll(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

function cleanHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '');
}

function isStandIn(host: string): boolean {
  return STAND_INS.includes(host);
}

/** `%41` → `A`, leaving a `%` that starts no escape as it is (`decodeURIComponent` throws on one). */
function percentDecoded(value: string): string {
  let out = value;
  for (let round = 0; round < 3; round += 1) {
    const next = out.replaceAll(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Character references decoded as HTML decodes them, by parse5 itself: `&#58;`, `&colon;`, `&NewLine;`. */
function entitiesDecoded(value: string): string {
  if (!value.includes('&')) return value;
  const fragment = parseFragment(`<textarea>\n${value.replaceAll('<', '&lt;')}</textarea>`);
  const area = fragment.childNodes[0];
  const text = area !== undefined && 'childNodes' in area ? area.childNodes[0] : undefined;
  return text !== undefined && 'value' in text ? text.value : value;
}

/** The forms of a value a reader might act on: as written, and decoded once more. */
function forms(value: string): string[] {
  return [...new Set([value, entitiesDecoded(value), percentDecoded(value), percentDecoded(entitiesDecoded(value))])];
}

/** One address, as a browser reads it with no page around it. */
function readUrl(value: string): Read {
  // eslint-disable-next-line no-control-regex -- what a URL parser drops from each end is exactly what is taken off
  const v = value.replaceAll(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '').replace(/[\u0000- ]+$/, '');
  if (v === '') return NOTHING;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    try {
      url = new URL(v, BASE);
    } catch {
      return { scheme: null, hosts: [], bad: `"${shown(value)}" cannot be read as an address` };
    }
    // A path on no host links nowhere outside; `//host` and `\\host` name one.
    if (url.hostname === BASE_HOST) return NOTHING;
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme === 'http:' || scheme === 'https:' || scheme === 'ftp:' || scheme === 'ws:' || scheme === 'wss:') {
    const host = cleanHost(url.hostname);
    return host === '' ? { scheme, hosts: [], bad: `"${shown(value)}" names no host` } : { scheme, hosts: [host] };
  }
  if (scheme === 'mailto:') {
    const hosts: string[] = [];
    for (const match of percentDecoded(`${url.pathname}${url.search}`).matchAll(/@([^\s,;?&<>"'@]+)/g)) {
      try {
        hosts.push(cleanHost(new URL(`https://${match[1]!}`).hostname));
      } catch {
        return { scheme, hosts: [], bad: `"${shown(value)}" names an address whose host cannot be read` };
      }
    }
    return { scheme, hosts };
  }
  return { scheme, hosts: [] };
}

function sameRead(a: Read, b: Read): boolean {
  return a.scheme === b.scheme && (a.bad === undefined) === (b.bad === undefined) && [...a.hosts].sort().join(' ') === [...b.hosts].sort().join(' ');
}

/**
 * One value that IS an address (an `href`, a button's url): its host, or the
 * problem. `strict` refuses a kind of address an email may not hold.
 */
function readAddress(raw: string, c: Collector, strict: boolean): void {
  for (const value of forms(raw)) readOneAddress(value, c, strict);
}

function readOneAddress(value: string, c: Collector, strict: boolean): void {
  const placeholders = placeholdersIn(value);
  const own = placeholders.filter((one) => c.self.has(one.name));
  const others = placeholders.filter((one) => !c.self.has(one.name));
  const write = (backups: boolean, probe?: { at: number; with: string }): string => {
    let out = '';
    let cursor = 0;
    for (const one of placeholders) {
      out += value.slice(cursor, one.at);
      cursor = one.at + one.whole.length;
      if (probe !== undefined && probe.at === one.at) out += probe.with;
      else if (backups && one.backup !== undefined) out += one.backup;
      else out += c.self.has(one.name) ? SELF : 'a';
    }
    return out + value.slice(cursor);
  };
  const variants = placeholders.some((one) => one.backup !== undefined) ? [false, true] : [false];
  for (const backups of variants) {
    const read = readUrl(write(backups));
    if (read.bad !== undefined) {
      c.problems.add(`a link in it: ${read.bad}`);
      continue;
    }
    if (strict && read.scheme !== null && !SAFE_SCHEMES.has(read.scheme)) {
      c.problems.add(`a link in it uses "${read.scheme}", which an email may not link to: "${shown(value)}"`);
      continue;
    }
    // A host a value filled in later can move is not a host anybody can tick.
    for (const other of others) {
      if (PROBES.some((probe) => !sameRead(read, readUrl(write(backups, { at: other.at, with: probe }))))) {
        c.problems.add(`a link in it goes to an address filled in only when it is sent: "${shown(value)}"`);
        break;
      }
    }
    const outside = read.hosts.filter((host) => host !== SELF_HOST);
    for (const host of outside) {
      if (host.includes(SELF_HOST) || host.includes(PROBE_HOST)) {
        c.problems.add(`a link in it goes to an address filled in only when it is sent: "${shown(value)}"`);
        continue;
      }
      if (isStandIn(host)) continue;
      c.hosts.add(host);
      if (others.length > 0) c.carried.add(host);
      // This server's own link (a password reset) handed to another host is never what a file means.
      if (own.length > 0) c.problems.add(`it sends {{${own[0]!.name}}} to "${host}"`);
    }
  }
}

/** Words: every host a mail client would link in them on its own. */
function readWords(raw: string, c: Collector): void {
  for (const value of forms(raw)) readOneWords(value, c);
}

function readOneWords(value: string, c: Collector): void {
  const placeholders = placeholdersIn(value);
  const variants = placeholders.some((one) => one.backup !== undefined) ? [false, true] : [false];
  for (const backups of variants) {
    let text = '';
    let cursor = 0;
    for (const one of placeholders) {
      text += value.slice(cursor, one.at);
      cursor = one.at + one.whole.length;
      text += backups && one.backup !== undefined ? one.backup : c.self.has(one.name) ? SELF : VAR;
    }
    text += value.slice(cursor);
    for (const token of text.split(/[\s<>"'`]+/u)) {
      if (token === '') continue;
      const carries = token.includes(VAR);
      const carriesOwn = token.includes(SELF);
      const found: string[] = [];
      for (const start of token.matchAll(SCHEME_IN_WORDS)) {
        const candidate = token.slice(start.index);
        const read = readUrl(candidate.replaceAll(VAR, 'a'));
        if (candidate.includes(VAR) && !sameRead(read, readUrl(candidate.replaceAll(VAR, `.${PROBE_HOST}/`)))) {
          c.problems.add(`a link in it goes to an address filled in only when it is sent: "${shown(candidate.replaceAll(VAR, '{{…}}'))}"`);
        }
        found.push(...read.hosts);
      }
      // `//host` with no scheme, where a reader takes it for one.
      for (const start of token.matchAll(/(?<![:/\\])[/\\]{2}(?![/\\])/g)) found.push(...readUrl(token.slice(start.index).replaceAll(VAR, 'a')).hosts);
      const bare = token.replaceAll(VAR, ' ').replaceAll(SELF, ' ');
      for (const match of [...bare.matchAll(DOMAIN), ...bare.matchAll(IPV4)]) {
        try {
          found.push(cleanHost(new URL(`https://${match[0]}`).hostname));
        } catch {
          // Not a host after all (a label too long): nothing a client links.
        }
      }
      for (const host of found) {
        if (host === SELF_HOST || isStandIn(host)) continue;
        if (host.includes(SELF_HOST)) {
          c.problems.add(`it names an address built on one of this server's own links: "${shown(token.replaceAll(SELF, '{{…}}').replaceAll(VAR, '{{…}}'))}"`);
          continue;
        }
        c.hosts.add(host);
        if (carries) c.carried.add(host);
        if (carriesOwn) c.problems.add(`it sends one of this server's own links to "${host}"`);
      }
    }
  }
}

/** A style sheet or a `style` attribute: every `url(…)`, `@import` and string in it, and code it may not run. */
function readCss(raw: string, c: Collector): void {
  const css = raw
    .replaceAll(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�';
    })
    .replaceAll(/\\([^\n])/g, '$1')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ');
  if (/expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:/i.test(css)) c.problems.add('a style in it runs code');
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) readAddress((match[1] ?? match[2] ?? match[3] ?? '').trim(), c, true);
  for (const match of css.matchAll(/@import\s*(?:"([^"]*)"|'([^']*)')/gi)) readAddress(match[1] ?? match[2] ?? '', c, true);
  for (const match of css.matchAll(/"([^"]*)"|'([^']*)'/g)) readWords(match[1] ?? match[2] ?? '', c);
  readWords(css, c);
}

function attributeName(attr: { name: string; prefix?: string }): string {
  const name = attr.name.toLowerCase();
  const colon = name.lastIndexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

function textOfChildren(el: Element): string {
  return el.childNodes.map((child) => ('value' in child && child.nodeName === '#text' ? child.value : '')).join('');
}

/** Markup: every element, attribute and word in it, as a browser builds them. */
function readHtml(code: string, c: Collector, depth: number): void {
  if (depth > MAX_DEPTH) {
    c.problems.add('it holds markup nested too deep to read');
    return;
  }
  // As written too: whatever a reader that is not a browser makes of it, its words name no other host.
  readWords(code, c);
  const stack: Node[] = [parseFragment(code, { scriptingEnabled: false })];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.nodeName === '#text' && 'value' in node) {
      readWords(node.value, c);
      continue;
    }
    if (node.nodeName === '#comment' && 'data' in node) {
      // Outlook reads markup inside `<!--[if mso]>…<![endif]-->`.
      readHtml(node.data, c, depth + 1);
      continue;
    }
    if ('tagName' in node) {
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (CODE_ELEMENTS.has(tag)) c.problems.add(`it holds a <${tag}>, which runs code`);
      if (tag === 'style') readCss(textOfChildren(el), c);
      const isRefresh = tag === 'meta' && el.attrs.some((attr) => attr.name.toLowerCase() === 'http-equiv' && attr.value.trim().toLowerCase() === 'refresh');
      for (const attr of el.attrs) {
        const name = attributeName(attr);
        const value = attr.value;
        if (name.startsWith('on')) c.problems.add(`it runs code when "${attr.name}" fires`);
        if (URL_ATTRIBUTES.has(name)) readAddress(value, c, true);
        if (LIST_ATTRIBUTES.has(name)) for (const part of value.split(',')) readAddress(part.trim().split(/\s+/)[0] ?? '', c, true);
        if (WORD_ATTRIBUTES.has(name)) for (const part of value.split(/[\s,]+/)) readAddress(part, c, true);
        if (name === 'style') readCss(value, c);
        if (name === 'srcdoc') readHtml(value, c, depth + 1);
        if (isRefresh && name === 'content') {
          const target = /url\s*=\s*(?:"([^"]*)"?|'([^']*)'?|(.*))/i.exec(value);
          if (target !== null) readAddress((target[1] ?? target[2] ?? target[3] ?? '').trim(), c, true);
          else if (/[;,]/.test(value)) readAddress(value.slice(value.search(/[;,]/) + 1).trim(), c, true);
        }
        readWords(value, c);
      }
      const content = (el as Element & { content?: Node }).content;
      if (tag === 'template' && content !== undefined) stack.push(content);
    }
    if ('childNodes' in node) for (let k = node.childNodes.length - 1; k >= 0; k -= 1) stack.push(node.childNodes[k]!);
  }
}

/**
 * Every outside host an email's content can send a person to or load from,
 * and why any address in it cannot be told. `self` names the placeholders
 * that hold this server's own links (`resetUrl`).
 */
export function emailLinks(content: unknown, self: Iterable<string> = []): EmailLinks {
  const c: Collector = { self: new Set(self), hosts: new Set(), carried: new Set(), problems: new Set() };
  const visit = (value: unknown, field: string | null, depth: number): void => {
    if (depth > 64) {
      c.problems.add('it is nested too deep to read');
      return;
    }
    if (typeof value === 'string') {
      if (field !== null && LINK_FIELD.test(field)) readAddress(value, c, true);
      readWords(value, c);
      return;
    }
    if (Array.isArray(value)) {
      for (const one of value) visit(one, field, depth + 1);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    // Raw markup: read as markup, wherever its block sits.
    const data = record['data'];
    if (record['block'] === 'email.html' && data !== null && typeof data === 'object' && typeof (data as Record<string, unknown>)['code'] === 'string') {
      readHtml((data as Record<string, unknown>)['code'] as string, c, 0);
    }
    for (const [key, one] of Object.entries(record)) if (!STRUCTURE.has(key)) visit(one, key, depth + 1);
  };
  visit(content, null, 0);
  return { hosts: [...c.hosts].sort(), carried: [...c.carried].sort(), problems: [...c.problems].sort() };
}
