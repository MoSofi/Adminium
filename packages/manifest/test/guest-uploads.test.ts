// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's file into a file column (`rules.file.upload`, an entry's
 * `uploads`), as the manifest check reads it: the upload's kinds are kinds
 * the column takes, no larger, no more than it holds; an entry lists only
 * writable file columns that say what a guest may send, on a create or a
 * change, at its own level or a child row's; a column both uploaded into and
 * offered for download is allowed; TIFF and file columns past 25 MiB; and
 * every new word asks for the release that reads it.
 */
import { describe, expect, it } from 'vitest';

import { FILE_COLUMN_EARLIER_MAX_BYTES, FILE_COLUMN_KINDS, FILE_COLUMN_MAX_BYTES, FILE_UPLOAD_KINDS, installFloorWords, WORD_FLOORS } from '../src/index.js';
import { columnOf, entryOf, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

const MB = 1024 * 1024;
const ARTWORK = { accept: ['pdf', 'jpeg', 'png', 'tiff'], maxBytes: 100 * MB, upload: { kinds: ['pdf', 'jpg', 'png', 'tiff'], maxBytes: 100 * MB } };

const create = (m: Doc) => entryOf(m, 'orders', 'POST');
const lines = (m: Doc) => (create(m)['children'] as Record<string, Doc>)['order_items']!;

/** The kitchen, with an artwork column on its lines a guest uploads into, and a logo on the person's own row. */
function printShop(): Doc {
  const m = kitchen();
  m['compatibility'] = { minAdminiumVersion: '0.3.43' };
  ((m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'order_items')!['columns'] as Doc[]).push({ ref: 'artwork', type: 'text', maxLength: 64, nullable: true, rules: { file: structuredClone(ARTWORK) } });
  ((m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'customers')!['columns'] as Doc[]).push({
    ref: 'logos',
    type: 'json',
    nullable: true,
    rules: { file: { accept: ['png', 'jpeg'], maxBytes: 4 * MB, maxCount: 3, upload: { kinds: ['png', 'jpg'], maxBytes: 2 * MB, maxCount: 2 } } },
  });
  const line = lines(m);
  (line['writable'] as string[]).push('artwork');
  line['uploads'] = ['artwork'];
  // The person changes their own logos and reads them back.
  const person = entryOf(m, 'customers', 'PATCH');
  (person['writable'] as string[]).push('logos');
  (person['select'] as string[]).push('logos');
  person['uploads'] = ['logos'];
  return m;
}

describe("a guest's upload into a file column", () => {
  it('validates on a create\'s child row and on a signed-in change, and asks for the release that reads it', () => {
    expect(messages(printShop())).toEqual([]);
    const words = installFloorWords(printShop()).filter((found) => ['file.upload', 'publicAccess.uploads', 'file.tiff', 'file.large'].includes(found.word));
    expect(words.map((found) => `${found.word} ${found.path}`).sort()).toEqual(
      [
        'file.large requiredSchema.tables.6.columns.9.rules.file.maxBytes',
        'file.tiff requiredSchema.tables.6.columns.9.rules.file.accept',
        'file.upload requiredSchema.tables.1.columns.5.rules.file.upload',
        'file.upload requiredSchema.tables.6.columns.9.rules.file.upload',
        'publicAccess.uploads publicAccess.0.uploads',
        'publicAccess.uploads publicAccess.6.children.order_items.uploads',
      ].sort(),
    );
    for (const word of ['file.upload', 'publicAccess.uploads', 'file.tiff', 'file.large'] as const) expect(WORD_FLOORS[word]).toBe('0.3.43');
    const older = printShop();
    older['compatibility'] = { minAdminiumVersion: '0.3.42' };
    expect(issuesText(older)).toContain('publicAccess.uploads');
  });

  it('takes files up to 100 MiB and TIFF; 25 MiB was the most before', () => {
    expect(FILE_COLUMN_MAX_BYTES).toBe(100 * MB);
    expect(FILE_COLUMN_EARLIER_MAX_BYTES).toBe(25 * MB);
    expect(FILE_COLUMN_KINDS).toContain('tiff');
    expect(FILE_UPLOAD_KINDS).toEqual({ jpg: 'jpeg', png: 'png', pdf: 'pdf', text: 'text', tiff: 'tiff' });
    const m = printShop();
    (columnOf(m, 'order_items', 'artwork')['rules'] as { file: Doc }).file['maxBytes'] = 100 * MB + 1;
    expect(issuesText(m)).toContain('maxBytes');
    // At 25 MiB a column needs no newer release for its size.
    const small = printShop();
    (columnOf(small, 'order_items', 'artwork')['rules'] as { file: Doc }).file = { accept: ['pdf'], maxBytes: FILE_COLUMN_EARLIER_MAX_BYTES, upload: { kinds: ['pdf'], maxBytes: MB } };
    expect(installFloorWords(small).map((found) => found.word)).not.toContain('file.large');
  });

  it('takes only kinds the column takes, no larger, no more than the column holds', () => {
    const broken = (change: (rule: Doc) => void, column: [string, string] = ['order_items', 'artwork']) => {
      const m = printShop();
      change((columnOf(m, ...column)['rules'] as { file: Doc }).file);
      return issuesText(m);
    };
    expect(broken((rule) => (rule['accept'] = ['pdf', 'png']))).toContain(`a guest's "jpg" file is one the column takes: add "jpeg" to accept`);
    expect(broken((rule) => ((rule['upload'] as Doc)['kinds'] = ['pdf', 'pdf']))).toContain('each kind of file is named once');
    expect(broken((rule) => ((rule['upload'] as Doc)['kinds'] = ['svg']))).toContain('kinds');
    expect(broken((rule) => ((rule['upload'] as Doc)['kinds'] = ['heic']))).toContain('kinds');
    expect(broken((rule) => ((rule['upload'] as Doc)['maxBytes'] = 101 * MB))).toContain('maxBytes');
    expect(broken((rule) => (rule['maxBytes'] = 10 * MB))).toContain("a guest's file is no larger than the column takes (10485760 bytes)");
    expect(broken((rule) => ((rule['upload'] as Doc)['maxCount'] = 2))).toContain('the column holds one file, so a guest uploads one');
    expect(broken((rule) => ((rule['upload'] as Doc)['maxCount'] = 4), ['customers', 'logos'])).toContain('a guest uploads no more files than the column holds (3)');
  });

  it('lists only writable file columns that say what a guest may send, on a create or a change', () => {
    const broken = (change: (m: Doc) => void) => {
      const m = printShop();
      change(m);
      return issuesText(m);
    };
    expect(broken((m) => (lines(m)['uploads'] = ['nope']))).toContain('"order_items" has no column "nope"');
    expect(broken((m) => (lines(m)['uploads'] = ['note']))).toContain('"order_items.note" holds no files: give it a file rule (rules.file)');
    expect(
      broken((m) => {
        delete ((columnOf(m, 'order_items', 'artwork')['rules'] as { file: Doc }).file['upload']);
      }),
    ).toContain('"order_items.artwork" does not say what a guest may upload');
    expect(broken((m) => (lines(m)['writable'] = (lines(m)['writable'] as string[]).filter((c) => c !== 'artwork')))).toContain('"artwork" is filled by naming the upload, so it is writable');
    expect(broken((m) => (lines(m)['uploads'] = ['artwork', 'artwork']))).toContain('each column is named once');
    // A read-only entry names no upload.
    expect(
      broken((m) => {
        const read = entryOf(m, 'menu_items', 'GET');
        read['uploads'] = ['name'];
      }),
    ).toContain("a guest's upload is named by a create or a change, and this entry makes neither");
  });

  it('lets a column a guest uploads into be read back as their own file, and no other writable one', () => {
    const m = printShop();
    const person = entryOf(m, 'customers', 'PATCH');
    person['files'] = ['logos'];
    // The person's own row: the claim is its own entry's, so `files` is theirs (the column is json: files hold text only).
    expect(issuesText(m)).not.toContain('is offered for download, so a browser never writes it');
    const plain = printShop();
    const own = entryOf(plain, 'customers', 'PATCH');
    own['files'] = ['name'];
    expect(issuesText(plain)).toContain('"name" is offered for download, so a browser never writes it');
  });
});
