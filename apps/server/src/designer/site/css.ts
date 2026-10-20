// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stylesheet of a site template, made fit to copy into an app. The app's public page bundles it,
 * so it must load nothing from another site and name no file the template lacks. It is kept as it
 * is, with four changes: comments are taken out (a licence comment that opens with `/*!` stays),
 * addresses on other sites are taken out, file extensions are written in lower case (the copier
 * stores the files that way), and a `url()` to a file the template lacks becomes `none`.
 *
 * The stylesheet is read the way a browser reads it, token by token, with escapes decoded: `u\72l(`
 * is `url(` to a browser, so it is here too. An address is wherever a browser would load one: a
 * `url()`, an `@import` (with or without `url()`), and the strings of `image-set()`. One is kept only
 * when it is a file the site holds or a picture written inline (`data:image/png` and the like).
 * Anything else, and anything this file cannot read with certainty, becomes `none` and is listed.
 * A `url(` inside a string or a comment is only text, and a string is left exactly as it was.
 *
 * The result is read again until nothing changes: taking a comment or a rule out must never join
 * what was left into an address the first reading did not see.
 */

export interface CssCleaned {
  /** The stylesheet as it is copied, with the four changes. Starts with a short comment listing the changes made. */
  css: string;
  /** Each address taken out, and why: plain words, at most 200 entries. */
  removed: { address: string; why: 'remote' | 'missing' | 'not-allowed' }[];
  /** The local stylesheets it imports (resolved site paths, in order): the copier keeps them. */
  imports: string[];
  /** The other sites it loaded a stylesheet or a font from (hosts only, lower case, deduplicated), e.g. fonts.googleapis.com: a later step offers to self-host them. */
  hosts: string[];
  /** The site files it names that were kept (resolved site paths, deduplicated): the copier copies these. */
  files: string[];
}

type Why = CssCleaned['removed'][number]['why'];

/** The most addresses listed as taken out; a template with more is listed in part. */
export const CSS_REMOVED_LISTED = 200;
/** The most characters of one address shown: an inline picture can be very long. */
const ADDRESS_SHOWN = 200;
/** How many times the result is read again before it is given up as unreadable. */
const READINGS = 4;

const HEADER =
  '/* Copied from the template by Adminium Designer, with four changes: comments taken out (a licence comment that opens with an exclamation mark is kept), addresses on other sites taken out, file extensions in lower case, and a url() to a file the template lacks set to none. */\n';

/** The only inline addresses kept: pictures that cannot run anything. */
const DATA_PICTURE = /^data:image\/(png|jpeg|gif|webp)(;[^,]*)?,/i;
const REMOTE = /^(https?|ftp|wss?):/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** What a URL reader drops at both ends of an address: spaces and control characters. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is dropped
const EDGE_SPACE = /^[\x00-\x20]+|[\x00-\x20]+$/g;
/** What a URL reader drops anywhere in an address. */
const TAB_OR_NEWLINE = /[\t\n\r]/g;
/** Functions whose string arguments are addresses. */
const STRING_ADDRESSES = /^((-[a-z]+-)?image-set|image)$/;
/** The functions an `image-set()` may hold. Any other, `var()` above all, could bring in a string the reading cannot see. */
const IN_IMAGE_SET = /^(url|src|type|image|(-[a-z]+-)?image-set|(-[a-z]+-)?(repeating-)?(linear|radial|conic)-gradient|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|calc|min|max|clamp)$/;

/**
 * Resolves an address a stylesheet (or page) at `from` names, to a site path: null when it leaves the site or is not a relative path.
 * Query and fragment dropped; percent-escapes decoded; a leading '/' is from the site's top; the extension lower-cased.
 */
export function resolveSitePath(from: string, address: string): string | null {
  // Read as a browser's URL reader does: spaces at the ends and tabs and newlines anywhere are dropped, a backslash is a slash.
  let rest = address.replace(EDGE_SPACE, '').replace(TAB_OR_NEWLINE, '').replace(/\\/g, '/');
  if (rest === '' || rest.startsWith('//') || SCHEME.test(rest)) return null;
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  if (rest === '') return null;
  const top = rest.startsWith('/');
  const parts = top ? [] : from.split('/').slice(0, -1);
  const names = (top ? rest.slice(1) : rest).split('/');
  for (const [k, part] of names.entries()) {
    let name: string;
    try {
      name = decodeURIComponent(part);
    } catch {
      return null;
    }
    // A slash or control character that was escaped is not a folder a browser walks into: not certain, so not a path.
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
    if (/[/\\\x00-\x1f\x7f]/.test(name)) return null;
    // A browser reads `%2e%2e` as `..`, so the check comes after decoding. A path ending in a dot part names a folder.
    if (name === '.' || name === '..') {
      if (name === '..' && parts.pop() === undefined) return null;
      if (k === names.length - 1) return null;
      continue;
    }
    if (name === '') return null;
    parts.push(name);
  }
  const last = parts.length - 1;
  parts[last] = lowerExtension(parts[last] ?? '');
  return parts.join('/');
}

/** Cleans one stylesheet of a site template. `path` is its own path in the site; `has` says whether the site holds a file. */
export function cleanCss(text: string, opts: { path: string; has: (path: string) => boolean }): CssCleaned {
  const ledger = new Ledger(opts.path, opts.has);
  // A byte order mark is not part of the text; left in, it would join the first selector.
  let body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let settled = false;
  for (let reading = 0; reading < READINGS && !settled; reading++) {
    const next = cleanOnce(body, ledger);
    settled = reading > 0 && next === body;
    body = next;
  }
  if (!settled) {
    body = '';
    ledger.drop('the whole stylesheet', 'not-allowed');
  }
  // `@charset` counts only as the very first bytes, so the header goes after it.
  const charset = /^@charset "[^"]*";/.exec(body)?.[0] ?? '';
  const css = (charset ? `${charset}\n` : '') + HEADER + body.slice(charset.length);
  return { css, removed: ledger.removed, imports: [...ledger.imports], hosts: [...ledger.hosts], files: [...ledger.files] };
}

/** What a cleaning finds, kept across readings. */
class Ledger {
  readonly removed: CssCleaned['removed'] = [];
  readonly imports = new Set<string>();
  readonly hosts = new Set<string>();
  readonly files = new Set<string>();
  /** Addresses taken out so far, listed or not: a font source entry is left out when it grows. */
  drops = 0;
  inFontSource = false;
  private readonly listed = new Set<string>();

  constructor(
    readonly path: string,
    readonly has: (path: string) => boolean,
  ) {}

  drop(address: string, why: Why): null {
    this.drops++;
    const shown = address.length > ADDRESS_SHOWN ? `${address.slice(0, ADDRESS_SHOWN - 1)}…` : address;
    const key = `${why} ${shown}`;
    if (!this.listed.has(key) && this.removed.length < CSS_REMOVED_LISTED) {
      this.listed.add(key);
      this.removed.push({ address: shown, why });
    }
    return null;
  }

  host(address: string): void {
    try {
      const host = new URL(address.startsWith('//') ? `https:${address}` : address).hostname.toLowerCase();
      if (host) this.hosts.add(host);
    } catch {
      // Not readable as an address: no host to offer.
    }
  }
}

type Use = 'url' | 'import' | 'font';

/** What an address becomes: the path to write in `url("…")`, or null when it is taken out (and listed). */
function judgeAddress(address: string, use: Use, ledger: Ledger): string | null {
  const shown = address.replace(EDGE_SPACE, '');
  const plain = shown.replace(TAB_OR_NEWLINE, '');
  if (/^data:/i.test(plain)) return DATA_PICTURE.test(plain) ? plain : ledger.drop(shown, 'not-allowed');
  const slashed = plain.replace(/\\/g, '/');
  if (slashed.startsWith('//') || REMOTE.test(slashed)) {
    if (use !== 'url') ledger.host(slashed);
    return ledger.drop(shown, 'remote');
  }
  if (SCHEME.test(slashed)) return ledger.drop(shown, 'not-allowed');
  const path = resolveSitePath(ledger.path, address);
  if (path === null) return ledger.drop(shown, 'not-allowed');
  if (!ledger.has(path)) return ledger.drop(shown, 'missing');
  (use === 'import' ? ledger.imports : ledger.files).add(path);
  // Written relative to the stylesheet's folder, decoded: the bundler finds files by their real names.
  const cut = slashed.search(/[?#]/);
  return relativeTo(ledger.path, path) + (cut < 0 ? '' : slashed.slice(cut));
}

type Mode = 'plain' | 'image-set' | 'font-face';

/** One reading: the stylesheet with comments and addresses dealt with. */
function cleanOnce(text: string, ledger: Ledger): string {
  const tokens = tokenize(text);
  const close = pairs(tokens);
  const out: string[] = [];
  const raw = (k: number): string => {
    const t = tokens[k];
    return t ? text.slice(t.start, t.end) : '';
  };
  /** The text of tokens `from` to `to`, both included. */
  const span = (from: number, to: number): string => text.slice(tokens[from]?.start ?? text.length, tokens[Math.min(to, tokens.length - 1)]?.end ?? text.length).trim();
  const lastChar = (): string => {
    for (let k = out.length - 1; k >= 0; k--) {
      const piece = out[k] ?? '';
      if (piece) return piece.charAt(piece.length - 1);
    }
    return '';
  };
  /** A space where taking something out would join what stood on either side into one token. */
  const gap = (nextAt: number): string => (joins(lastChar(), text.charAt(nextAt)) ? ' ' : '');
  const significant = (from: number, to: number): Token[] => tokens.slice(from, to).filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
  const writeAddress = (address: string, use: Use): void => {
    const kept = judgeAddress(address, use, ledger);
    out.push(kept === null ? 'none' : `url(${cssString(kept)})`);
  };
  /** The index past an `@import` rule's end, its prelude's end, and whether it ends in a semicolon or a block. */
  const ruleEnd = (from: number, end: number): { last: number; prelude: number; ending: ';' | '{' | '' } => {
    for (let k = from; k < end; k++) {
      const kind = tokens[k]?.kind;
      if (kind === ';') return { last: k, prelude: k, ending: ';' };
      if (kind === '{') return { last: Math.min(close[k] ?? end, end - 1), prelude: k, ending: '{' };
      if (kind === 'function' || kind === '(' || kind === '[') k = Math.min(close[k] ?? end, end - 1);
    }
    return { last: end - 1, prelude: end, ending: '' };
  };

  const walk = (start: number, end: number, mode: Mode): void => {
    let atRule = '';
    let statementStart = true;
    for (let i = start; i < end; i++) {
      const t = tokens[i];
      if (!t) break;
      const c = close[i] ?? tokens.length;
      const name = asciiLower(t.value);
      if (t.kind === 'ws') {
        out.push(raw(i));
        continue;
      }
      if (t.kind === 'comment') {
        const body = raw(i);
        if (body.startsWith('/*!')) out.push(body.length >= 5 && body.endsWith('*/') ? body : `${body}*/`);
        else out.push(gap(t.end));
        continue;
      }
      if (t.kind === 'at' && name === 'import') {
        const { last, prelude, ending } = ruleEnd(i + 1, end);
        const first = significant(i + 1, prelude)[0];
        const at = first ? tokens.indexOf(first, i + 1) : -1;
        let address: string | null = null;
        let after = at + 1;
        if (first?.kind === 'string' || first?.kind === 'url') address = first.value;
        else if (first?.kind === 'function' && /^(url|src)$/.test(asciiLower(first.value))) {
          const inner = significant(at + 1, close[at] ?? tokens.length);
          if (inner.length === 1 && inner[0]?.kind === 'string') address = inner[0].value;
          after = (close[at] ?? tokens.length) + 1;
        }
        const kept = ending === '{' || address === null ? ledger.drop(span(i + 1, prelude - 1) || '@import', 'not-allowed') : judgeAddress(address, 'import', ledger);
        if (kept === null) out.push(gap(tokens[last]?.end ?? text.length));
        else {
          out.push(`@import url(${cssString(kept)})`);
          walk(after, prelude, 'plain');
          if (ending === ';') out.push(';');
        }
        i = last;
        statementStart = true;
        continue;
      }
      if (t.kind === 'url') {
        writeAddress(t.value, ledger.inFontSource ? 'font' : 'url');
      } else if (t.kind === 'bad-url') {
        out.push('none');
        ledger.drop(raw(i), 'not-allowed');
      } else if (t.kind === 'function' && (name === 'url' || name === 'src')) {
        // A url() written with quotes holds one string; anything more is not certain.
        const inner = significant(i + 1, c);
        if (inner.length === 1 && inner[0]?.kind === 'string') writeAddress(inner[0].value, ledger.inFontSource ? 'font' : 'url');
        else {
          out.push('none');
          ledger.drop(span(i, c), 'not-allowed');
        }
        i = c;
      } else if (t.kind === 'function' && STRING_ADDRESSES.test(name)) {
        if (tokens.slice(i + 1, c).some((inner) => inner.kind === 'function' && !IN_IMAGE_SET.test(asciiLower(inner.value)))) {
          out.push('none');
          ledger.drop(span(i, c), 'not-allowed');
        } else {
          out.push(raw(i));
          walk(i + 1, c, 'image-set');
          out.push(raw(c));
        }
        i = c;
      } else if ((t.kind === 'string' || t.kind === 'bad-string') && mode === 'image-set') {
        if (t.kind === 'string') writeAddress(t.value, ledger.inFontSource ? 'font' : 'url');
        else {
          out.push('none');
          ledger.drop(raw(i), 'not-allowed');
        }
      } else if (t.kind === 'ident' && mode === 'font-face' && statementStart && name === 'src' && tokens[significantFrom(tokens, i + 1, end)]?.kind === ':') {
        // A font source is a list: an entry whose address is taken out is left out, so the others still load.
        const colon = significantFrom(tokens, i + 1, end);
        walk(i, colon + 1, 'plain');
        const commas: number[] = [];
        let v = colon + 1;
        for (; v < end && tokens[v]?.kind !== ';'; v++) {
          const kind = tokens[v]?.kind;
          if (kind === ',') commas.push(v);
          else if (kind === 'function' || kind === '(' || kind === '[' || kind === '{') v = Math.min(close[v] ?? end, end - 1);
        }
        const starts = [colon + 1, ...commas.map((k) => k + 1)];
        const ends = [...commas, v];
        const kept: string[] = [];
        ledger.inFontSource = true;
        starts.forEach((from, k) => {
          const mark = out.length;
          const drops = ledger.drops;
          walk(from, ends[k] ?? v, 'plain');
          const entry = out.splice(mark).join('');
          if (ledger.drops === drops) kept.push(entry);
        });
        ledger.inFontSource = false;
        out.push(kept.length ? kept.join(',') : ' none');
        i = v - 1;
        statementStart = false;
        continue;
      } else if (t.kind === 'function' || t.kind === '(' || t.kind === '[' || t.kind === '{') {
        out.push(raw(i));
        walk(i + 1, c, t.kind === '{' && atRule === 'font-face' ? 'font-face' : 'plain');
        out.push(raw(c));
        i = c;
        if (t.kind === '{') {
          atRule = '';
          statementStart = true;
          continue;
        }
      } else {
        out.push(raw(i));
        if (t.kind === 'at') atRule = name;
        if (t.kind === ';') {
          atRule = '';
          statementStart = true;
          continue;
        }
      }
      statementStart = false;
    }
  };

  walk(0, tokens.length, 'plain');
  return out.join('');
}

/** The index of the next token from `from` that is not a space or a comment. */
function significantFrom(tokens: Token[], from: number, end: number): number {
  let k = from;
  while (k < end && (tokens[k]?.kind === 'ws' || tokens[k]?.kind === 'comment')) k++;
  return k;
}

/** Whether two characters, side by side with nothing between, would read as one token where a comment kept them two. */
function joins(before: string, after: string): boolean {
  if (!before || !after) return false;
  const p = before.charCodeAt(0);
  const q = after.charCodeAt(0);
  const nameAfter = isNameChar(q) || q === 92;
  if (isNameChar(p) && (nameAfter || q === 40 || q === 37 || (isDigit(p) && q === 46))) return true;
  if ((p === 64 || p === 35) && nameAfter) return true;
  if ((p === 43 || p === 46) && (isDigit(q) || q === 46)) return true;
  if ((p === 47 && q === 42) || (p === 60 && q === 33) || (p === 45 && q === 62)) return true;
  return (q === 61 && '|~^$*'.includes(before)) || (p === 124 && q === 124);
}

/** A string as CSS writes it: quotes, backslashes and control characters escaped. */
function cssString(text: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is escaped
  return `"${text.replace(/["\\]/g, '\\$&').replace(/[\x00-\x1f\x7f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/** The path from the folder of `from` to `to`, both site paths, starting `./` or `../`. */
function relativeTo(from: string, to: string): string {
  const folder = from.split('/').slice(0, -1);
  const target = to.split('/');
  let same = 0;
  while (same < folder.length && same < target.length - 1 && folder[same] === target[same]) same++;
  const up = folder.length - same;
  return (up ? '../'.repeat(up) : './') + target.slice(same).join('/');
}

function lowerExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) + name.slice(dot).toLowerCase() : name;
}

/** CSS compares names in ASCII lower case only. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// The reader: CSS split into tokens as a browser splits it, with escapes decoded in names, strings and addresses.

type Kind = 'ws' | 'comment' | 'string' | 'bad-string' | 'url' | 'bad-url' | 'function' | 'at' | 'ident' | 'hash' | 'number' | 'delim' | '(' | ')' | '[' | ']' | '{' | '}' | ';' | ':' | ',' | 'cdo' | 'cdc';

interface Token {
  kind: Kind;
  start: number;
  end: number;
  /** The decoded name of an identifier, function, at-rule or hash, or the decoded value of a string or address. */
  value: string;
}

const REPLACEMENT = String.fromCharCode(0xfffd);
const PUNCTUATION = new Map<number, Kind>([
  [40, '('],
  [41, ')'],
  [91, '['],
  [93, ']'],
  [123, '{'],
  [125, '}'],
  [59, ';'],
  [58, ':'],
  [44, ','],
]);

const isNewline = (c: number): boolean => c === 10 || c === 13 || c === 12;
const isSpace = (c: number): boolean => c === 32 || c === 9 || isNewline(c);
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isHex = (c: number): boolean => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
// A NUL reads as U+FFFD, which is a name character like any other beyond ASCII.
const isIdentStart = (c: number): boolean => isLetter(c) || c === 95 || c >= 0x80 || c === 0;
const isNameChar = (c: number): boolean => isIdentStart(c) || isDigit(c) || c === 45;

function tokenize(s: string): Token[] {
  const n = s.length;
  const at = (k: number): number => (k < n ? s.charCodeAt(k) : -1);
  const validEscape = (k: number): boolean => at(k) === 92 && !isNewline(at(k + 1));
  const startsIdent = (k: number): boolean => {
    const c = at(k);
    if (c === 45) return isIdentStart(at(k + 1)) || at(k + 1) === 45 || validEscape(k + 1);
    return isIdentStart(c) || validEscape(k);
  };
  const startsNumber = (k: number): boolean => {
    const c = at(k) === 43 || at(k) === 45 ? at(++k) : at(k);
    return isDigit(c) || (c === 46 && isDigit(at(k + 1)));
  };
  /** An escape: `k` is just past the backslash. */
  const escape = (k: number): [string, number] => {
    const c = at(k);
    if (c === -1 || c === 0) return [REPLACEMENT, k + (c === 0 ? 1 : 0)];
    if (isHex(c)) {
      let e = k;
      while (e < k + 6 && isHex(at(e))) e++;
      const code = parseInt(s.slice(k, e), 16);
      if (at(e) === 13 && at(e + 1) === 10) e += 2;
      else if (isSpace(at(e))) e++;
      return [code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff ? REPLACEMENT : String.fromCodePoint(code), e];
    }
    const ch = String.fromCodePoint(s.codePointAt(k) ?? 0xfffd);
    return [ch, k + ch.length];
  };
  const name = (k: number): [string, number] => {
    let v = '';
    for (;;) {
      const c = at(k);
      if (isNameChar(c)) {
        v += c === 0 ? REPLACEMENT : s.charAt(k);
        k++;
      } else if (validEscape(k)) {
        const [ch, e] = escape(k + 1);
        v += ch;
        k = e;
      } else return [v, k];
    }
  };
  const number = (k: number): number => {
    if (at(k) === 43 || at(k) === 45) k++;
    while (isDigit(at(k))) k++;
    if (at(k) === 46 && isDigit(at(k + 1))) for (k += 2; isDigit(at(k)); ) k++;
    if ((at(k) === 69 || at(k) === 101) && (isDigit(at(k + 1)) || ((at(k + 1) === 43 || at(k + 1) === 45) && isDigit(at(k + 2))))) for (k += 2; isDigit(at(k)); ) k++;
    if (startsIdent(k)) return name(k)[1];
    return at(k) === 37 ? k + 1 : k;
  };
  const string = (k: number, quote: number): [Kind, string, number] => {
    let v = '';
    for (;;) {
      const c = at(k);
      if (c === quote) return ['string', v, k + 1];
      if (c === -1) return ['string', v, k];
      if (isNewline(c)) return ['bad-string', v, k];
      if (c === 92) {
        const d = at(k + 1);
        if (d === -1) k++;
        else if (isNewline(d)) k += d === 13 && at(k + 2) === 10 ? 3 : 2;
        else {
          const [ch, e] = escape(k + 1);
          v += ch;
          k = e;
        }
        continue;
      }
      v += c === 0 ? REPLACEMENT : s.charAt(k);
      k++;
    }
  };
  const remnants = (k: number): number => {
    for (;;) {
      const c = at(k);
      if (c === -1) return k;
      if (c === 41) return k + 1;
      k = validEscape(k) ? escape(k + 1)[1] : k + 1;
    }
  };
  /** An address written without quotes: `k` is just past `url(`. */
  const url = (k: number): [Kind, string, number] => {
    let v = '';
    while (isSpace(at(k))) k++;
    for (;;) {
      const c = at(k);
      if (c === 41) return ['url', v, k + 1];
      if (c === -1) return ['url', v, k];
      if (c === 0) {
        v += REPLACEMENT;
        k++;
      } else if (isSpace(c)) {
        while (isSpace(at(k))) k++;
        if (at(k) === 41) return ['url', v, k + 1];
        if (at(k) === -1) return ['url', v, k];
        return ['bad-url', v, remnants(k)];
      } else if (c === 34 || c === 39 || c === 40 || c <= 8 || c === 11 || (c >= 14 && c <= 31) || c === 127) return ['bad-url', v, remnants(k)];
      else if (c === 92) {
        if (!validEscape(k)) return ['bad-url', v, remnants(k)];
        const [ch, e] = escape(k + 1);
        v += ch;
        k = e;
      } else {
        v += s.charAt(k);
        k++;
      }
    }
  };

  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: Kind, end: number, value = ''): void => {
    tokens.push({ kind, start: i, end, value });
    i = end;
  };
  while (i < n) {
    const c = at(i);
    const punctuation = PUNCTUATION.get(c);
    if (c === 47 && at(i + 1) === 42) {
      const e = s.indexOf('*/', i + 2);
      push('comment', e < 0 ? n : e + 2);
    } else if (isSpace(c)) {
      let e = i;
      while (isSpace(at(e))) e++;
      push('ws', e);
    } else if (c === 34 || c === 39) {
      const [kind, v, e] = string(i + 1, c);
      push(kind, e, v);
    } else if (c === 35 && (isNameChar(at(i + 1)) || validEscape(i + 1))) {
      const [v, e] = name(i + 1);
      push('hash', e, v);
    } else if (punctuation) push(punctuation, i + 1);
    else if ((c === 43 || c === 45 || c === 46 || isDigit(c)) && startsNumber(i)) push('number', number(i));
    else if (c === 45 && s.startsWith('-->', i)) push('cdc', i + 3);
    else if (c === 60 && s.startsWith('<!--', i)) push('cdo', i + 4);
    else if (c === 64 && startsIdent(i + 1)) {
      const [v, e] = name(i + 1);
      push('at', e, v);
    } else if (startsIdent(i)) {
      const [v, e] = name(i);
      if (at(e) !== 40) push('ident', e, v);
      else if (asciiLower(v) !== 'url') push('function', e + 1, v);
      else {
        // `url(` then a quote is a function holding a string; anything else is an address written bare.
        let k = e + 1;
        while (isSpace(at(k)) && isSpace(at(k + 1))) k++;
        const q = isSpace(at(k)) ? at(k + 1) : at(k);
        if (q === 34 || q === 39) push('function', e + 1, v);
        else {
          const [kind, address, end] = url(e + 1);
          push(kind, end, address);
        }
      }
    } else push('delim', i + (c >= 0xd800 && c <= 0xdbff && at(i + 1) >= 0xdc00 && at(i + 1) <= 0xdfff ? 2 : 1), String.fromCharCode(c));
  }
  return tokens;
}

/** For each token that opens a group, the index of the token that closes it (the token count when it never closes). */
function pairs(tokens: Token[]): number[] {
  const close = tokens.map(() => tokens.length);
  const open: number[] = [];
  const closer = (kind: Kind | undefined): Kind | '' => (kind === 'function' || kind === '(' ? ')' : kind === '[' ? ']' : kind === '{' ? '}' : '');
  tokens.forEach((t, k) => {
    if (closer(t.kind)) open.push(k);
    else if (open.length && t.kind === closer(tokens[open[open.length - 1] ?? -1]?.kind)) close[open.pop() ?? k] = k;
  });
  return close;
}
