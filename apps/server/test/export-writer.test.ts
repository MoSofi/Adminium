// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shared export row writer (41-export-builder.md §3.3, D6, D7).
 *
 * One writer for the job and the preview, so these are the rules the "Raw
 * file" tab shows AND the rules the downloaded file follows: masked cells
 * read `•••••`, JSON Lines is keyed by header text with numeric values
 * spliced unquoted, empty is `null`, the header row can be switched off —
 * and the legacy mode is byte-for-byte what shipped before.
 */
import { describe, expect, it } from 'vitest';

import { EXPORT_BOM } from '../src/data-io/csv.js';
import { MASKED_CELL, createRowWriter, type WriterColumn } from '../src/export/writer.js';

const COLUMNS: WriterColumn[] = [
  { key: 'number', header: 'Invoice number', numeric: false },
  { key: 'total', header: 'Sum of line total', numeric: true },
  { key: 'contact_email', header: 'Contact email', numeric: false },
  { key: 'issued_on', header: 'Issued on', numeric: false },
];

const ROW = {
  number: 'INV-007',
  total: '4820.00',
  contact_email: null,
  issued_on: new Date('2026-06-03T00:00:00Z'),
  _masked: ['contact_email'],
};

describe('csv', () => {
  it('writes the BOM, the header labels, bullets for a masked cell, and ISO dates', () => {
    const writer = createRowWriter('csv', COLUMNS);
    expect(writer.preamble()).toBe(EXPORT_BOM);
    expect(writer.headerLine()).toBe('Invoice number,Sum of line total,Contact email,Issued on\r\n');
    expect(writer.line(ROW)).toBe(`INV-007,4820.00,${MASKED_CELL},2026-06-03T00:00:00.000Z\r\n`);
    expect(writer.extension).toBe('csv');
  });

  it('writes an unmarked null as empty and quotes what needs quoting', () => {
    const writer = createRowWriter('csv', COLUMNS);
    expect(writer.line({ number: 'Ana, Trujillo', total: null, contact_email: 'x@y.z', issued_on: '' })).toBe(
      '"Ana, Trujillo",,x@y.z,\r\n',
    );
  });

  it('omits the header line when the option is off', () => {
    const writer = createRowWriter('csv', COLUMNS, { headerRow: false });
    expect(writer.headerLine()).toBeNull();
    expect(writer.preamble()).toBe(EXPORT_BOM);
  });
});

describe('json lines', () => {
  it('keys by header, splices numbers unquoted, writes null for empty and a string for a masked cell', () => {
    const writer = createRowWriter('json', COLUMNS);
    expect(writer.preamble()).toBe('');
    expect(writer.headerLine()).toBeNull();
    expect(writer.line(ROW)).toBe(
      `{"Invoice number":"INV-007","Sum of line total":4820.00,"Contact email":"${MASKED_CELL}","Issued on":"2026-06-03T00:00:00.000Z"}\n`,
    );
    expect(writer.extension).toBe('jsonl');
    expect(writer.mime).toBe('application/x-ndjson');
  });

  it('keeps a wide decimal exact and quotes a numeric column that does not read as a number', () => {
    const writer = createRowWriter('json', [{ key: 'v', header: 'V', numeric: true }]);
    expect(writer.line({ v: '12345678901234567890.123456' })).toBe('{"V":12345678901234567890.123456}\n');
    expect(writer.line({ v: '1,300' })).toBe('{"V":"1,300"}\n');
    expect(writer.line({ v: '' })).toBe('{"V":null}\n');
    expect(writer.line({ v: 7 })).toBe('{"V":7}\n');
  });

  it('writes a non-numeric column as a JSON string whatever the driver returned', () => {
    const writer = createRowWriter('json', [{ key: 'b', header: 'B', numeric: false }]);
    expect(writer.line({ b: true })).toBe('{"B":"true"}\n');
    expect(writer.line({ b: 42 })).toBe('{"B":"42"}\n');
  });
});

describe('legacy mode (the pre-definition shape)', () => {
  const legacyColumns: WriterColumn[] = [
    { key: 'number', header: 'number', numeric: false },
    { key: 'contact_email', header: 'contact_email', numeric: false },
  ];

  it('writes column names as the header and a masked cell as empty', () => {
    const writer = createRowWriter('csv', legacyColumns, { legacy: true });
    expect(writer.headerLine()).toBe('number,contact_email\r\n');
    expect(writer.line(ROW)).toBe('INV-007,\r\n');
  });

  it('keys JSON Lines by column name with the driver’s own values', () => {
    const writer = createRowWriter('json', legacyColumns, { legacy: true });
    expect(writer.line({ number: 'INV-007', contact_email: null, _masked: ['contact_email'] })).toBe(
      '{"number":"INV-007","contact_email":null}\n',
    );
  });
});
