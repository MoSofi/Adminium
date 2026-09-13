// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `parseXrefBack` — the walker the PDF conformance case trusts, tested on its own.
 *
 * `describeDocumentRenderer` only ever hands it tables that are right, because
 * the reference writer writes them right, so every REFUSAL in it went
 * unexecuted. A walker that had quietly stopped refusing would have kept the
 * suite green over exactly the writers it exists to catch. Each case below is
 * one way a hand-rolled writer gets the table wrong, and each must be refused
 * by name.
 */
import { describe, expect, it } from 'vitest';

import { parseXrefBack } from '../src/testing/index.js';

/** An ASCII string's bytes — one character, one byte. */
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

/**
 * A minimal PDF, written as text with its offsets taken from `String.length`.
 *
 * For an ASCII body that is correct, because a character is a byte. The last
 * case feeds it a body that is not, which is 34 §0.3 trap 8 in miniature.
 */
function pdf(bodies: readonly string[]): string {
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  bodies.forEach((body, at) => {
    offsets.push(text.length);
    text += `${String(at + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${String(bodies.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return (
    `${text}trailer\n<</Size ${String(bodies.length + 1)}/Root 1 0 R>>\n` +
    `startxref\n${String(xref)}\n%%EOF\n`
  );
}

const BODIES = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[]/Count 0>>'] as const;
const GOOD = pdf(BODIES);
const TABLE_AT = Number(/startxref\n(\d+)/.exec(GOOD)?.[1]);

describe('parseXrefBack', () => {
  it('walks a well-formed table to every object it names', () => {
    const { objects, offsets } = parseXrefBack(ascii(GOOD));
    expect(objects).toBe(2);
    expect(offsets).toEqual([GOOD.indexOf('1 0 obj'), GOOD.indexOf('2 0 obj')]);
  });

  it('refuses a file with no startxref', () => {
    expect(() => parseXrefBack(ascii(GOOD.replace('startxref', 'start')))).toThrow(
      'no startxref in the file',
    );
  });

  it('refuses a startxref that is not followed by an offset and %%EOF', () => {
    const broken = GOOD.replace(`startxref\n${String(TABLE_AT)}`, 'startxref\nsomewhere');
    expect(() => parseXrefBack(ascii(broken))).toThrow(
      'startxref is not followed by an offset and %%EOF',
    );
  });

  it('refuses a startxref that points anywhere but the table', () => {
    const broken = GOOD.replace(`startxref\n${String(TABLE_AT)}`, `startxref\n${String(TABLE_AT - 1)}`);
    expect(() => parseXrefBack(ascii(broken))).toThrow(
      `startxref points at ${String(TABLE_AT - 1)}, which is not the start of an xref table`,
    );
  });

  it('refuses a table with no subsection header', () => {
    const broken = GOOD.replace(/xref\n0 3\n[\s\S]*?trailer/, 'xref\ntrailer');
    expect(() => parseXrefBack(ascii(broken))).toThrow('the xref table has no subsection header');
  });

  it('refuses a first subsection that does not start at object 0', () => {
    expect(() => parseXrefBack(ascii(GOOD.replace('xref\n0 3\n', 'xref\n1 3\n')))).toThrow(
      'the first xref subsection must start at object 0',
    );
  });

  it('refuses an entry that is not exactly twenty bytes', () => {
    // An entry ends in a TWO-byte line ending. A writer that emits a bare
    // newline shifts every entry after it by one byte.
    expect(() => parseXrefBack(ascii(GOOD.replace('65535 f \n', '65535 f\n')))).toThrow(
      'xref entry 0 is not twenty bytes',
    );
  });

  it('refuses a table whose object 0 is not the head of the free list', () => {
    expect(() => parseXrefBack(ascii(GOOD.replace('65535 f \n', '65535 n \n')))).toThrow(
      'object 0 must be the free-list head',
    );
  });

  it('refuses an object marked free that the file uses', () => {
    const first = GOOD.indexOf(' 00000 n \n');
    const broken = `${GOOD.slice(0, first)} 00000 f \n${GOOD.slice(first + ' 00000 n \n'.length)}`;
    expect(() => parseXrefBack(ascii(broken))).toThrow('object 1 is marked free but is in use');
  });

  it('refuses an offset that lands anywhere but the object it names', () => {
    const second = GOOD.indexOf('2 0 obj');
    const broken = GOOD.replace(
      `${String(second).padStart(10, '0')} 00000 n`,
      `${String(second + 1).padStart(10, '0')} 00000 n`,
    );
    expect(() => parseXrefBack(ascii(broken))).toThrow(
      `xref sends object 2 to ${String(second + 1)}`,
    );
  });

  it('refuses offsets counted in characters over a file written in UTF-8', () => {
    // `ü` is one character and two bytes, so everything after it, the table
    // included, sits one byte later than the offsets written from `String.length`.
    const text = pdf(['<</Title(Müller)>>', BODIES[1]]);
    expect(() => parseXrefBack(new TextEncoder().encode(text))).toThrow(
      /^startxref points at \d+, which is not the start of an xref table$/,
    );
  });
});
