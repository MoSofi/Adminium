// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The stored reference (37-files-and-storage.md D7/D31, §3.6, 37-T04).
 *
 * The asymmetry is the whole design and is what these tests pin: WRITING uses
 * exactly the configured shape, READING accepts all three plus "this is
 * somebody else's link, leave it alone". A column can therefore be adopted
 * without a migration and abandoned without one — and a foreign app that has
 * been writing its own URLs into that column keeps working.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REF_SHAPE,
  formatRef,
  formatRefList,
  parseRef,
  parseRefList,
  REF_MIN_WIDTH,
  REF_SHAPES,
} from '../src/files/refs.js';

const ID = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD';
const ORIGIN = 'https://admin.example.com';
const DESTINATIONS = [
  { id: 'dest_01M1Q000000000000000000001', publicBaseUrl: 'https://cdn.example.com/files' },
  { id: 'dest_01M1Q000000000000000000002', publicBaseUrl: null },
];

describe('formatRef — writing uses exactly the configured shape', () => {
  const target = { id: ID, storageKey: 'invoices/upload/2026/09/file_01M1Q-inv-1042.pdf' };

  it('mints an id', () => {
    expect(formatRef('id', target, ORIGIN)).toBe(ID);
  });

  it('mints the driver key', () => {
    expect(formatRef('key', target, ORIGIN)).toBe('invoices/upload/2026/09/file_01M1Q-inv-1042.pdf');
  });

  it('mints an Adminium content URL from the REQUEST’s origin', () => {
    // There is no ADMINIUM_BASE_URL (`security/csrf.ts:32` says so), so a url
    // reference names the instance the upload actually went through.
    expect(formatRef('url', target, ORIGIN)).toBe(`${ORIGIN}/api/v1/files/${ID}/content`);
    // A trailing slash on the origin must not double up.
    expect(formatRef('url', target, 'https://admin.example.com/')).toBe(`${ORIGIN}/api/v1/files/${ID}/content`);
  });

  it('prefers a destination’s public base — the point of configuring one', () => {
    const published = { ...target, publicBaseUrl: 'https://cdn.example.com/files/' };
    expect(formatRef('url', published, ORIGIN)).toBe(
      'https://cdn.example.com/files/invoices/upload/2026/09/file_01M1Q-inv-1042.pdf',
    );
    // The other two shapes ignore it: an id is an id and a key is a key.
    expect(formatRef('id', published, ORIGIN)).toBe(ID);
    expect(formatRef('key', published, ORIGIN)).toBe(target.storageKey);
  });

  it('defaults to url (D31) and names all three shapes', () => {
    expect(DEFAULT_REF_SHAPE).toBe('url');
    expect([...REF_SHAPES]).toEqual(['url', 'id', 'key']);
  });

  it('publishes a minimum column width per shape, so ColumnManager can refuse', () => {
    expect(REF_MIN_WIDTH.id).toBe(ID.length);
    expect(REF_MIN_WIDTH.key).toBeGreaterThan(REF_MIN_WIDTH.id);
    expect(REF_MIN_WIDTH.url).toBeGreaterThan(REF_MIN_WIDTH.key);
    // A varchar(40) can hold an id and nothing else — the case the editor
    // explains rather than truncating.
    expect(REF_MIN_WIDTH.id).toBeLessThanOrEqual(40);
    expect(REF_MIN_WIDTH.url).toBeGreaterThan(40);
  });
});

describe('parseRef — reading accepts all three shapes', () => {
  it('recognises a bare id', () => {
    expect(parseRef(ID)).toEqual({ kind: 'id', id: ID });
    // Whitespace around a pasted value is not a different value.
    expect(parseRef(`  ${ID}  `)).toEqual({ kind: 'id', id: ID });
  });

  it('recognises an Adminium content URL from ANY origin', () => {
    // The instance that changed hostname, and the value written through a
    // reverse proxy under another name, both still name a file this server has.
    for (const origin of ['https://admin.example.com', 'http://localhost:4700', 'https://old-name.internal:8443']) {
      expect(parseRef(`${origin}/api/v1/files/${ID}/content`)).toEqual({ kind: 'id', id: ID });
    }
    // A query string (a cache-buster, a download flag) does not change what it names.
    expect(parseRef(`${ORIGIN}/api/v1/files/${ID}/content?inline=1`)).toEqual({ kind: 'id', id: ID });
    expect(parseRef(`${ORIGIN}/api/v1/files/${ID}/content/`)).toEqual({ kind: 'id', id: ID });
  });

  it('recognises a public base of an enabled destination and yields the key', () => {
    expect(parseRef('https://cdn.example.com/files/invoices/2026/09/a.pdf', DESTINATIONS)).toEqual({
      kind: 'key',
      key: 'invoices/2026/09/a.pdf',
      publicBaseUrl: 'https://cdn.example.com/files',
    });
    // Without the destination in scope — it was disabled, or deleted — the same
    // value is somebody else's link, which is the honest reading.
    expect(parseRef('https://cdn.example.com/files/invoices/2026/09/a.pdf')).toEqual({
      kind: 'external',
      href: 'https://cdn.example.com/files/invoices/2026/09/a.pdf',
    });
  });

  it('does not let a public base match a sibling path', () => {
    // `…/files-archive/…` must not be read as `…/files/` + `-archive/…`.
    expect(parseRef('https://cdn.example.com/files-archive/a.pdf', DESTINATIONS)).toEqual({
      kind: 'external',
      href: 'https://cdn.example.com/files-archive/a.pdf',
    });
    // The base itself, with nothing after it, names no object.
    expect(parseRef('https://cdn.example.com/files/', DESTINATIONS)).toEqual({
      kind: 'external',
      href: 'https://cdn.example.com/files/',
    });
  });

  it('recognises a bare driver key', () => {
    expect(parseRef('invoices/upload/2026/09/file_01M1Q-inv-1042.pdf')).toEqual({
      kind: 'key',
      key: 'invoices/upload/2026/09/file_01M1Q-inv-1042.pdf',
    });
  });

  it('classifies twelve foreign values as external and touches none of them', () => {
    const foreign = [
      'https://example.com/uploads/legacy.pdf',
      'http://intranet.local/share/scan-001.tiff',
      '//cdn.example.org/asset.png',
      '/var/www/uploads/photo.jpg',
      'file:///Users/ava/Desktop/receipt.pdf',
      's3://someone-elses-bucket/key.pdf',
      'gs://bucket/object',
      'data:image/png;base64,iVBORw0KGgo=',
      'ftp://files.example.com/pub/a.zip',
      'mailto:ava@example.com',
      'not a url at all',
      'C:\\Users\\ava\\invoice.pdf',
    ];
    for (const value of foreign) {
      const parsed = parseRef(value, DESTINATIONS);
      expect(parsed, value).toEqual({ kind: 'external', href: value });
    }
  });

  it('reads an empty value as no reference at all', () => {
    expect(parseRef('')).toBeNull();
    expect(parseRef('   ')).toBeNull();
  });

  it('round-trips every shape it writes', () => {
    const target = { id: ID, storageKey: 'invoices/upload/2026/09/file_01M1Q-inv.pdf' };
    expect(parseRef(formatRef('id', target, ORIGIN))).toEqual({ kind: 'id', id: ID });
    expect(parseRef(formatRef('url', target, ORIGIN))).toEqual({ kind: 'id', id: ID });
    expect(parseRef(formatRef('key', target, ORIGIN))).toEqual({ kind: 'key', key: target.storageKey });

    const published = { ...target, publicBaseUrl: 'https://cdn.example.com/files' };
    expect(parseRef(formatRef('url', published, ORIGIN), DESTINATIONS)).toEqual({
      kind: 'key',
      key: target.storageKey,
      publicBaseUrl: 'https://cdn.example.com/files',
    });
  });
});

/**
 * The LIST grammar (38-files-library-and-attachments.md D1/D5).
 *
 * A `multiple` column stores a JSON array of references in a `text` column, so
 * every existing reader keeps seeing a string. The reason this is a grammar
 * rather than a `json` column is in §0.3 of the plan; the reason it is
 * TOLERANT is the same asymmetry the tests above pin — a column may be made
 * `multiple` long after it started holding one plain value, and a foreign app
 * may keep writing its own links into it.
 */
const ID2 = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE';

describe('parseRefList — a column that holds many files', () => {

  it('reads a JSON array of ids', () => {
    expect(parseRefList(JSON.stringify([ID, ID2]))).toEqual([
      { kind: 'id', id: ID },
      { kind: 'id', id: ID2 },
    ]);
  });

  it('reads a BARE value as a list of one — the column before it was made multiple', () => {
    // No migration is run when a column gains `multiple`, so yesterday's single
    // reference has to keep resolving.
    expect(parseRefList(ID)).toEqual([{ kind: 'id', id: ID }]);
    expect(parseRefList(`${ORIGIN}/api/v1/files/${ID}/content`)).toEqual([{ kind: 'id', id: ID }]);
  });

  it('keeps a foreign entry as external rather than dropping it', () => {
    // The reconciler passes over `external`; losing it here would make a mixed
    // column silently lose the links somebody else owns.
    expect(parseRefList(JSON.stringify([ID, 'https://example.com/theirs.pdf']))).toEqual([
      { kind: 'id', id: ID },
      { kind: 'external', href: 'https://example.com/theirs.pdf' },
    ]);
  });

  it('resolves a destination’s public base inside a list', () => {
    expect(parseRefList(JSON.stringify(['https://cdn.example.com/files/a/b.pdf']), DESTINATIONS)).toEqual([
      { kind: 'key', key: 'a/b.pdf', publicBaseUrl: 'https://cdn.example.com/files' },
    ]);
  });

  it('is empty for nothing at all', () => {
    for (const value of [null, undefined, '', '   ', 42, {}, []]) {
      expect(parseRefList(value)).toEqual([]);
    }
    expect(parseRefList('[]')).toEqual([]);
  });

  it('never throws on malformed JSON — the column is the customer’s, not ours', () => {
    // `"[not json"` is a string somebody put in their own column. It names
    // nothing of Adminium's, and saying so is the whole answer.
    expect(() => parseRefList('[not json')).not.toThrow();
    expect(parseRefList('[not json')).toEqual([{ kind: 'external', href: '[not json' }]);
    expect(parseRefList('[1, 2, 3]')).toEqual([]);
    expect(parseRefList('{"a":1}')).toEqual([{ kind: 'external', href: '{"a":1}' }]);
  });
});

describe('formatRefList — what gets written back', () => {
  it('writes a JSON array', () => {
    expect(formatRefList([ID, 'a/b.pdf'])).toBe(JSON.stringify([ID, 'a/b.pdf']));
  });

  it('writes NULL for an empty list, never "[]"', () => {
    // Absence is what a column that never held a file carries; removing the
    // last attachment must land in that same state rather than a second one
    // that means the same thing.
    expect(formatRefList([])).toBeNull();
  });

  it('round-trips through parseRefList', () => {
    const written = formatRefList([ID, ID2]);
    expect(parseRefList(written)).toEqual([
      { kind: 'id', id: ID },
      { kind: 'id', id: ID2 },
    ]);
  });
});
