// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared string-scanning primitives for the hand-rolled parsers. Everything
 * here is dependency-free by design (05-introspection-engine.md §5: no ANTLR,
 * no runtime `typescript` dependency — tokenizer level only).
 */

export interface ScanOptions {
  /** Recognize SQL `$tag$ ... $tag$` dollar quoting. */
  dollarQuotes?: boolean;
  /** Backslash escapes strings (JS/Python); SQL uses doubled quotes instead. */
  backslashEscapes?: boolean;
  /** Line-comment openers to skip, e.g. `['--']` (SQL), `['//']` (TS), `['#']` (Ruby/Python). */
  lineComments?: readonly string[];
  /** Skip block comments (slash-star … star-slash). */
  blockComments?: boolean;
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);
const QUOTES = new Set(["'", '"', '`']);

/**
 * If `text[i]` begins a string or comment, return the index just past it;
 * otherwise return `i`. The atom is never split, so callers can treat the
 * whole literal/comment as opaque.
 */
export function skipAtom(text: string, i: number, opts: ScanOptions = {}): number {
  const ch = text[i];
  if (ch === undefined) return i;

  for (const opener of opts.lineComments ?? []) {
    if (text.startsWith(opener, i)) {
      const nl = text.indexOf('\n', i);
      return nl === -1 ? text.length : nl + 1;
    }
  }
  if (opts.blockComments && text.startsWith('/*', i)) {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (opts.dollarQuotes && ch === '$') {
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
    if (m) {
      const tag = m[0];
      const end = text.indexOf(tag, i + tag.length);
      return end === -1 ? text.length : end + tag.length;
    }
  }
  if (QUOTES.has(ch)) {
    let j = i + 1;
    while (j < text.length) {
      const c = text[j];
      if (opts.backslashEscapes && c === '\\') {
        j += 2;
        continue;
      }
      if (c === ch) {
        // SQL-style doubled quote escape ('' or "") — stay inside the literal.
        if (!opts.backslashEscapes && text[j + 1] === ch) {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j += 1;
    }
    return text.length;
  }
  return i;
}

/** Split on `separator` at bracket depth 0, outside strings/comments. */
export function splitTopLevel(text: string, separator: string, opts: ScanOptions = {}): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const next = skipAtom(text, i, opts);
    if (next !== i) {
      i = next;
      continue;
    }
    const ch = text[i] as string;
    if (OPENERS[ch] !== undefined) depth += 1;
    else if (CLOSERS.has(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Given the index of an opening bracket, return the index of its matching
 * closer (or -1). Strings/comments are skipped as atoms.
 */
export function findBalanced(text: string, openIndex: number, opts: ScanOptions = {}): number {
  const open = text[openIndex];
  if (open === undefined || OPENERS[open] === undefined) return -1;
  const close = OPENERS[open];
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const next = skipAtom(text, i, opts);
    if (next !== i) {
      i = next;
      continue;
    }
    const ch = text[i];
    // Counting only the requested pair is sufficient for well-formed input.
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** Remove comments while preserving string literals verbatim. */
export function stripComments(text: string, opts: ScanOptions): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    const isComment =
      (opts.lineComments ?? []).some((c) => text.startsWith(c, i)) ||
      (opts.blockComments === true && text.startsWith('/*', i));
    const next = skipAtom(text, i, opts);
    if (next !== i) {
      if (isComment) {
        // Keep the newline of line comments so line numbers survive.
        const skipped = text.slice(i, next);
        out += skipped.replace(/[^\n]/g, '');
      } else {
        out += text.slice(i, next);
      }
      i = next;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Strip `"x"`, `'x'`, `` `x` `` or `[x]` quoting from an identifier. */
export function unquoteIdent(raw: string): string {
  const s = raw.trim();
  const first = s[0];
  const last = s[s.length - 1];
  if (s.length >= 2 && first !== undefined && QUOTES.has(first) && last === first) {
    return s.slice(1, -1).replaceAll(first + first, first);
  }
  if (s.length >= 2 && first === '[' && last === ']') return s.slice(1, -1);
  return s;
}

/** If `raw` is a quoted string literal, return its contents; else null. */
export function stringLiteral(raw: string): string | null {
  const s = raw.trim();
  const first = s[0];
  if (s.length >= 2 && first !== undefined && QUOTES.has(first) && s.endsWith(first)) {
    const body = s.slice(1, -1);
    return body.replaceAll('\\' + first, first).replaceAll(first + first, first);
  }
  return null;
}

/** Collect all top-level quoted strings inside `text` (e.g. an args list). */
export function collectStrings(text: string, opts: ScanOptions = {}): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (QUOTES.has(ch)) {
      const end = skipAtom(text, i, opts);
      const lit = stringLiteral(text.slice(i, end));
      if (lit !== null) found.push(lit);
      i = end;
      continue;
    }
    const next = skipAtom(text, i, opts);
    i = next === i ? i + 1 : next;
  }
  return found;
}

export interface ArgList {
  positional: string[];
  /** Raw value expressions keyed by option name. */
  named: Record<string, string>;
}

/**
 * Parse a Ruby (`key: value`), Python (`key=value`) or JS-object
 * (`key: value`) argument/option list into raw string values.
 */
export function parseArgs(text: string, style: 'ruby' | 'python' | 'js'): ArgList {
  const opts: ScanOptions =
    style === 'js'
      ? { backslashEscapes: true, lineComments: ['//'], blockComments: true }
      : { backslashEscapes: true, lineComments: ['#'] };
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const part of splitTopLevel(text, ',', opts)) {
    let m: RegExpExecArray | null = null;
    if (style === 'python') {
      m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(part);
    } else {
      // Ruby 1.9 hashes and JS object entries: `key:` / `"key":` / `'key':`.
      m = /^(?:(?:"([^"]+)")|(?:'([^']+)')|([A-Za-z_$][A-Za-z0-9_$]*))\s*:\s*([\s\S]+)$/.exec(part);
    }
    if (m) {
      if (style === 'python') {
        named[m[1] as string] = (m[2] as string).trim();
      } else {
        const key = (m[1] ?? m[2] ?? m[3]) as string;
        named[key] = (m[4] as string).trim();
      }
    } else {
      positional.push(part.trim());
    }
  }
  return { positional, named };
}

/** `'x'`/`"x"` → string, `123`/`1.5` → number, true/false/True/False → boolean, else null. */
export function scalarValue(raw: string): string | number | boolean | null {
  const s = raw.trim();
  const lit = stringLiteral(s);
  if (lit !== null) return lit;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|True)$/.test(s)) return true;
  if (/^(false|False)$/.test(s)) return false;
  return null;
}

const SPACE = /\s/;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * `\s` as a single-character test. Scanning a run of whitespace one character
 * at a time is linear, where a `\s+` sitting next to a `.*`/`[^x]*` in the same
 * regex is quadratic — the engine retries every split of the run.
 */
export function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE.test(ch);
}

/**
 * True when `text` holds one of the four code points `.` never matches
 * (`\n`, `\r`, `\u2028`, `\u2029`). A `(.*)$` / `(.+)$` tail rejects any text
 * containing one, so the hand-rolled line matchers must reject it too.
 */
export function hasLineTerminator(text: string): boolean {
  return LINE_TERMINATOR.test(text);
}

export function snakeCase(name: string): string {
  return name
    // `([A-Z]+)([A-Z][a-z])` was quadratic (CodeQL js/polynomial-redos): the
    // `[A-Z]+` run and the `[A-Z]` after it match the same characters, so a
    // long all-caps identifier retried every split at every start offset. The
    // lookahead keeps the split point identical — only the last upper-case
    // letter of a run can be followed by `[A-Z][a-z]` — while matching one
    // character per position.
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('-', '_')
    .toLowerCase();
}

/** Naive English pluralizer — enough for Rails `t.references` conventions. */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
  return word + 's';
}

/** Naive inverse of {@link pluralize}. */
export function singularize(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}
