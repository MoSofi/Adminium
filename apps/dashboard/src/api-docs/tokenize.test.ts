// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { codeLines, jsonLines } from './tokenize.js';

describe('jsonLines', () => {
  it('tones keys, strings, numbers, literals and punctuation', () => {
    const [, line] = jsonLines({ name: 'Ana', n: 2, ok: true });
    expect(line).toEqual([
      { text: '  ', tone: 'base' },
      { text: '"name"', tone: 'key' },
      { text: ':', tone: 'punct' },
      { text: ' ', tone: 'base' },
      { text: '"Ana"', tone: 'string' },
      { text: ',', tone: 'punct' },
    ]);
    expect(jsonLines({ ok: null })[1]?.some((t) => t.text === 'null' && t.tone === 'literal')).toBe(true);
  });

  it('reads an exponent as one number', () => {
    const tokens = jsonLines(1e21).flat();
    expect(tokens).toEqual([{ text: '1e+21', tone: 'number' }]);
  });

  it('returns text, never markup: a tag in a value stays a string token', () => {
    const tokens = jsonLines({ x: '<img src=x onerror=alert(1)>' }).flat();
    expect(tokens.some((t) => t.tone === 'string' && t.text.includes('<img'))).toBe(true);
  });
});

describe('codeLines', () => {
  it('greens strings and dims whole-line comments', () => {
    const [first, second] = codeLines(`curl 'https://x' \\\n# note`);
    expect(first).toEqual([
      { text: 'curl ', tone: 'base' },
      { text: "'https://x'", tone: 'string' },
      { text: ' \\', tone: 'base' },
    ]);
    expect(second).toEqual([{ text: '# note', tone: 'comment' }]);
  });
});
