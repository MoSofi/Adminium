// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The explorer's two highlighters, ported from the comp's `jsonLines` and
 * `hlCode`.
 *
 * They return DATA — lines of `{ text, tone }` — which the page renders as
 * React text. A response body is whatever a server sent, so it must never
 * reach the DOM as markup; a token is a string in a `<span>`, never HTML.
 *
 * The comp's number pattern has no exponent branch, so `1e+21` split into a
 * number and a stray word. This one reads it whole.
 */

export type Tone = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'comment' | 'base';

export interface Token {
  text: string;
  tone: Tone;
}

export type Line = Token[];

/** The `--code-*` ink each tone wears inside `.adm-always-dark`. */
export const TONE_CLASS: Readonly<Record<Tone, string>> = {
  key: 'text-code-blue',
  string: 'text-code-green',
  number: 'text-code-orange',
  literal: 'text-code-purple',
  punct: 'text-code-gray',
  comment: 'text-code-gray',
  base: 'text-fg-muted',
};

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],])|(\s+)|([^\s]+)/g;

/** A value printed as the explorer shows it: `JSON.stringify(value, null, 2)`, highlighted. */
export function jsonLines(value: unknown): Line[] {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return text.split('\n').map((line) => {
    const tokens: Token[] = [];
    for (const m of line.matchAll(JSON_TOKEN)) {
      if (m[1] !== undefined) {
        tokens.push({ text: m[1], tone: m[2] === undefined ? 'string' : 'key' });
        if (m[2] !== undefined) tokens.push({ text: m[2], tone: 'punct' });
      } else if (m[3] !== undefined) tokens.push({ text: m[3], tone: 'number' });
      else if (m[4] !== undefined) tokens.push({ text: m[4], tone: 'literal' });
      else if (m[5] !== undefined) tokens.push({ text: m[5], tone: 'punct' });
      else tokens.push({ text: m[0], tone: 'base' });
    }
    return tokens.length === 0 ? [{ text: ' ', tone: 'base' }] : tokens;
  });
}

const CODE_STRING = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;

/** A code sample: strings green, whole-line comments dim, the rest base. */
export function codeLines(code: string): Line[] {
  return code.split('\n').map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return [{ text: line.length > 0 ? line : ' ', tone: 'comment' }];
    const tokens: Token[] = [];
    let last = 0;
    for (const m of line.matchAll(CODE_STRING)) {
      const at = m.index;
      if (at > last) tokens.push({ text: line.slice(last, at), tone: 'base' });
      tokens.push({ text: m[0], tone: 'string' });
      last = at + m[0].length;
    }
    if (last < line.length) tokens.push({ text: line.slice(last), tone: 'base' });
    return tokens.length === 0 ? [{ text: ' ', tone: 'base' }] : tokens;
  });
}
