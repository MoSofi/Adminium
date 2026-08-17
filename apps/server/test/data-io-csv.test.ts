// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RFC 4180 CSV serializer/parser (M7-T07, data-io/csv.ts): quoting/escaping
 * rules, CRLF records, the documented BOM decision, streaming splits, and
 * the serialize → parse round trip.
 */
import { describe, expect, it } from 'vitest';

import {
  CRLF,
  EXPORT_BOM,
  createCsvParser,
  parseCsv,
  serializeCsvField,
  serializeCsvRow,
} from '../src/data-io/csv.js';

describe('serializeCsvField', () => {
  it('quotes only when needed and doubles embedded quotes (RFC 4180 §2.5–2.7)', () => {
    expect(serializeCsvField('plain')).toBe('plain');
    expect(serializeCsvField('with,comma')).toBe('"with,comma"');
    expect(serializeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(serializeCsvField('multi\nline')).toBe('"multi\nline"');
    expect(serializeCsvField('cr\rhere')).toBe('"cr\rhere"');
  });

  it('serializes null/undefined as the empty field and stringifies the rest', () => {
    expect(serializeCsvField(null)).toBe('');
    expect(serializeCsvField(undefined)).toBe('');
    expect(serializeCsvField(42)).toBe('42');
    expect(serializeCsvField(true)).toBe('true');
    expect(serializeCsvField({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('serializeCsvRow', () => {
  it('joins with commas and terminates every record with CRLF (§2.1)', () => {
    expect(serializeCsvRow(['a', 'b'])).toBe(`a,b${CRLF}`);
    expect(serializeCsvRow([null, 'x,y'])).toBe(`,"x,y"${CRLF}`);
  });
});

describe('parseCsv', () => {
  it('parses quoted fields, doubled quotes, and multiline cells', () => {
    const text = 'a,"b,1","say ""hi"""\r\n"multi\nline",plain,\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b,1', 'say "hi"'],
      ['multi\nline', 'plain', ''],
    ]);
  });

  it('handles LF-only and CR-only line endings', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('flushes a trailing row with no final newline', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('strips the leading BOM (the documented export prefix)', () => {
    expect(parseCsv(`${EXPORT_BOM}a,b\n`)).toEqual([['a', 'b']]);
  });
});

describe('streaming parser', () => {
  it('tolerates arbitrary chunk splits — even mid-quote and mid-CRLF', () => {
    const text = `${EXPORT_BOM}id,note\r\n1,"a ""long""\nnote"\r\n2,plain\r\n`;
    for (const size of [1, 2, 3, 5, 7]) {
      const parser = createCsvParser();
      const rows: string[][] = [];
      for (let i = 0; i < text.length; i += size) {
        rows.push(...parser.write(text.slice(i, i + size)));
      }
      rows.push(...parser.end());
      expect(rows, `chunk size ${size}`).toEqual([
        ['id', 'note'],
        ['1', 'a "long"\nnote'],
        ['2', 'plain'],
      ]);
    }
  });
});

describe('round trip', () => {
  it('serialize → parse is the identity on string matrices', () => {
    const matrix = [
      ['id', 'name', 'notes'],
      ['1', 'Alfreds "Futterkiste"', 'line one\nline two'],
      ['2', 'Ana, Trujillo', ''],
      ['3', 'trailing space ', ' leading'],
      ['4', 'çÜ†é 漢字', '\r\nCRLF cell'],
    ];
    const text = EXPORT_BOM + matrix.map((row) => serializeCsvRow(row)).join('');
    expect(parseCsv(text)).toEqual(matrix);
  });
});
