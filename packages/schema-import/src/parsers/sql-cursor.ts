// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tiny token cursor over a single SQL statement (comments already stripped).
 * Understands quoted identifiers ("x", `x`, [x]), string literals ('x' with
 * '' escapes) and balanced paren groups — the only shapes the DDL
 * mini-parsers need.
 */
import { findBalanced, unquoteIdent } from '../text.js';

const WORD_RE = /^[A-Za-z_][A-Za-z0-9_$]*/;

export class SqlCursor {
  private pos = 0;

  constructor(private readonly text: string) {}

  private skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos += 1;
  }

  eof(): boolean {
    this.skipWs();
    return this.pos >= this.text.length;
  }

  /** Current position (for raw-slice captures). */
  save(): number {
    this.skipWs();
    return this.pos;
  }

  /** Raw text between a saved position and the current one. */
  textFrom(start: number): string {
    return this.text.slice(start, this.pos).trim();
  }

  /** Consume a numeric literal; returns raw text or null. */
  tryNumber(): string | null {
    this.skipWs();
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  rest(): string {
    this.skipWs();
    return this.text.slice(this.pos);
  }

  /** Peek the next bare word, uppercased (null when next token is not a word). */
  peekWord(): string | null {
    this.skipWs();
    const m = WORD_RE.exec(this.text.slice(this.pos));
    return m ? (m[0] as string).toUpperCase() : null;
  }

  /** Consume and return the next bare word (uppercased), or null. */
  takeWord(): string | null {
    this.skipWs();
    const m = WORD_RE.exec(this.text.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0].toUpperCase();
  }

  /** Consume the given word sequence if (case-insensitively) present. */
  tryWords(...words: string[]): boolean {
    const save = this.pos;
    for (const word of words) {
      if (this.takeWord() !== word.toUpperCase()) {
        this.pos = save;
        return false;
      }
    }
    return true;
  }

  /** Consume one punctuation char if it matches. */
  tryChar(ch: string): boolean {
    this.skipWs();
    if (this.text[this.pos] === ch) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /**
   * Consume an identifier: quoted ("x" / `x` / [x]) or bare word. Returns the
   * unquoted spelling (bare identifiers keep their original case — imports
   * preserve author casing). Null when the next token is not an identifier.
   */
  takeIdentifier(): string | null {
    this.skipWs();
    const ch = this.text[this.pos];
    if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = this.pos + 1;
      while (j < this.text.length) {
        if (this.text[j] === close) {
          if (close !== ']' && this.text[j + 1] === close) {
            j += 2;
            continue;
          }
          const raw = this.text.slice(this.pos, j + 1);
          this.pos = j + 1;
          return unquoteIdent(raw);
        }
        j += 1;
      }
      return null;
    }
    const m = WORD_RE.exec(this.text.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  /** Consume a possibly schema-qualified identifier → parts. */
  takeQualifiedIdentifier(): string[] | null {
    const first = this.takeIdentifier();
    if (first === null) return null;
    const parts = [first];
    while (this.tryChar('.')) {
      const next = this.takeIdentifier();
      if (next === null) break;
      parts.push(next);
    }
    return parts;
  }

  /** If next token is `(`, consume the balanced group and return its inner text. */
  takeParenGroup(): string | null {
    this.skipWs();
    if (this.text[this.pos] !== '(') return null;
    const end = findBalanced(this.text, this.pos);
    if (end === -1) {
      const inner = this.text.slice(this.pos + 1);
      this.pos = this.text.length;
      return inner;
    }
    const inner = this.text.slice(this.pos + 1, end);
    this.pos = end + 1;
    return inner;
  }

  /** Consume a '...' string literal (with '' escapes); null otherwise. */
  takeStringLiteral(): string | null {
    this.skipWs();
    if (this.text[this.pos] !== "'") return null;
    let j = this.pos + 1;
    let out = '';
    while (j < this.text.length) {
      if (this.text[j] === "'") {
        if (this.text[j + 1] === "'") {
          out += "'";
          j += 2;
          continue;
        }
        this.pos = j + 1;
        return out;
      }
      out += this.text[j];
      j += 1;
    }
    this.pos = this.text.length;
    return out;
  }

  /**
   * Capture raw text until one of `stopWords` appears at paren depth 0 (or
   * end of input). Used for DEFAULT expressions and type tails.
   */
  takeUntilWords(stopWords: readonly string[]): string {
    this.skipWs();
    const stops = new Set(stopWords.map((w) => w.toUpperCase()));
    const start = this.pos;
    while (this.pos < this.text.length) {
      this.skipWs();
      if (this.pos >= this.text.length) break;
      const ch = this.text[this.pos] as string;
      if (ch === '(') {
        const end = findBalanced(this.text, this.pos);
        this.pos = end === -1 ? this.text.length : end + 1;
        continue;
      }
      if (ch === "'") {
        this.takeStringLiteral();
        continue;
      }
      if (ch === '"' || ch === '`' || ch === '[') {
        this.takeIdentifier();
        continue;
      }
      const m = WORD_RE.exec(this.text.slice(this.pos));
      if (m) {
        const word = (m[0] as string).toUpperCase();
        // NOT only stops when followed by NULL (DEFAULT expr `x NOT LIKE…` is unlikely in DDL).
        if (stops.has(word)) return this.text.slice(start, this.pos).trim();
        this.pos += m[0].length;
        continue;
      }
      this.pos += 1;
    }
    return this.text.slice(start).trim();
  }
}
