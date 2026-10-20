// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The site template's zip reader: a well-made zip and macOS's are read; every zip a reader could
 * read two ways is refused whole. Where the zip library the server already has (fflate) would take
 * the same bytes, the test says so: those are the cases a naive reader lets through.
 */
import { deflateRawSync } from 'node:zlib';

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { readZipDirectory, readZipEntry, ZIP_MAX_ENTRIES, type ZipRefusalReason } from '../src/designer/site/zip.js';
import { makeZip, type ZipPart } from './zip-maker.js';

const PAGE = '<!doctype html><html><body>Hi</body></html>';
const page = (over: Partial<ZipPart> = {}): ZipPart => ({ name: 'index.html', data: PAGE, ...over });

/** What the reader says of a zip: its reason and sentence, or the names it read. */
function refusal(zip: Buffer): { reason: ZipRefusalReason; message: string } | string[] {
  try {
    return readZipDirectory(zip, 'menu.zip').map((entry) => entry.name);
  } catch (error) {
    return { reason: (error as { reason: ZipRefusalReason }).reason, message: (error as Error).message };
  }
}
/** Whether fflate, a reader that does not check this, takes the zip. */
const naiveTakes = (zip: Buffer): boolean => {
  try {
    unzipSync(new Uint8Array(zip));
    return true;
  } catch {
    return false;
  }
};

describe('a well-made zip', () => {
  it('lists its entries and reads each one, stored or deflated, checked against its size and CRC', async () => {
    const zip = makeZip([page(), { name: 'css/', data: '' }, { name: 'css/site.css', data: 'body{color:red}', method: 0 }]);
    const entries = readZipDirectory(zip, 'site.zip');
    expect(entries.map((entry) => [entry.name, entry.type, entry.method])).toEqual([
      ['index.html', 'file', 8],
      ['css/', 'dir', 8],
      ['css/site.css', 'file', 0],
    ]);
    expect((await readZipEntry(zip, entries[0]!, 'site.zip')).toString()).toBe(PAGE);
    expect((await readZipEntry(zip, entries[2]!, 'site.zip')).toString()).toBe('body{color:red}');
  });

  it('is read as macOS writes it: a descriptor after every file, with or without its signature', async () => {
    const zip = makeZip([page({ descriptor: 'signed' }), { name: 'a.css', data: 'a{}', descriptor: 'bare' }]);
    const entries = readZipDirectory(zip, 'mac.zip');
    expect(entries.map((entry) => entry.name)).toEqual(['index.html', 'a.css']);
    expect((await readZipEntry(zip, entries[1]!, 'mac.zip')).toString()).toBe('a{}');
  });

  it('reads a name as UTF-8 only when the zip says so, and a link only when the zip was made on Unix', () => {
    expect(refusal(makeZip([page({ name: 'café.html' })]))).toEqual(['café.html']);
    const link = { name: 'logo.png', data: '../../etc/passwd', mode: 0o120777 };
    expect(readZipDirectory(makeZip([page(), link]), 'x.zip')[1]?.type).toBe('link');
    // The same bits from MS-DOS mean nothing: a plain file.
    expect(readZipDirectory(makeZip([page(), { ...link, madeBy: 0x0014 }]), 'x.zip')[1]?.type).toBe('file');
    expect(readZipDirectory(makeZip([page(), { name: 'fifo', data: '', mode: 0o010644 }]), 'x.zip')[1]?.type).toBe('other');
  });
});

describe('a zip read two ways is refused whole', () => {
  const cases: [string, Buffer, ZipRefusalReason, RegExp][] = [
    ['data before its first file (a self-extracting prefix)', makeZip([page()], { prefix: Buffer.from('MZ fake program') }), 'ZIP_FORM', /data before its first file/],
    ['a comment holding a second end record', makeZip([page()], { comment: Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]) }), 'ZIP_FORM', /second end record/],
    ['a ZIP64 locator', makeZip([page()], { zip64Locator: true }), 'ZIP_FORM', /ZIP64/],
    ['a ZIP64 extra field in the directory', makeZip([page({ extraCentral: Buffer.from([0x01, 0x00, 0x00, 0x00]) })]), 'ZIP_FORM', /ZIP64/],
    ['a ZIP64 extra field in a local header', makeZip([page({ extraLocal: Buffer.from([0x01, 0x00, 0x00, 0x00]) })]), 'ZIP_FORM', /ZIP64/],
    ['a size of 0xFFFFFFFF', makeZip([page({ size: 0xffffffff })]), 'ZIP_FORM', /ZIP64/],
    ['a second disk', makeZip([page()], { disk: 1 }), 'ZIP_FORM', /several disks/],
    ['a local name that differs from the directory', makeZip([page({ localName: 'evil.html' })]), 'ZIP_FORM', /two headers disagree/],
    ['a local method that differs', makeZip([page({ localMethod: 0 })]), 'ZIP_FORM', /two headers disagree/],
    ['local flags that differ', makeZip([page({ localFlags: 0x2 })]), 'ZIP_FORM', /two headers disagree/],
    ['a local size that differs, with no descriptor', makeZip([page({ localSize: 3 })]), 'ZIP_FORM', /two headers disagree/],
    ['a local CRC that differs, with no descriptor', makeZip([page({ localCrc: 7 })]), 'ZIP_FORM', /two headers disagree/],
    ['a descriptor that differs from the directory', makeZip([page({ descriptor: 'signed', descriptorCrc: 7 })]), 'ZIP_FORM', /descriptor disagrees/],
    ['two entries over the same bytes', makeZip([page(), { name: 'index.html', data: PAGE, pointsAt: 0 }]), 'ZIP_FORM', /share bytes/],
    ['bytes between two files', makeZip([page(), { name: 'a.css', data: 'a{}' }], { between: Buffer.from('hidden') }), 'ZIP_FORM', /between its files/],
    ['a name flagged UTF-8 that is not', makeZip([page({ nameBytes: Buffer.from([0x61, 0xff, 0x2e, 0x68]), flags: 0x800 })]), 'ZIP_FORM', /not the UTF-8/],
    ['a name in an old encoding', makeZip([page({ name: 'café.html', nameBytes: Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x68]), ascii: true })]), 'ZIP_FORM', /old encoding/],
    ['a password (bit 0)', makeZip([page({ flags: 0x1 })]), 'ZIP_ENCRYPTED', /^menu\.zip is locked with a password, so it cannot be read\.$/],
    ['strong encryption (bit 6)', makeZip([page({ flags: 0x41 })]), 'ZIP_ENCRYPTED', /locked with a password/],
    ['AES (method 99)', makeZip([page({ method: 99, stored: Buffer.from('x') })]), 'ZIP_ENCRYPTED', /locked with a password/],
    ['a compression it does not take (bzip2)', makeZip([page({ method: 12, stored: Buffer.from('x') })]), 'ZIP_METHOD', /only stored and deflate/],
    ['a stored file whose two sizes differ', makeZip([page({ method: 0, size: 5 })]), 'ZIP_DAMAGED', /does not match its own size/],
    ['bytes that are not a zip', Buffer.from('<html>not a zip at all</html>'), 'NOT_A_ZIP', /^menu\.zip is not a zip file that can be read\.$/],
  ];
  for (const [what, zip, reason, words] of cases) {
    it(`for ${what}`, () => {
      const said = refusal(zip);
      expect(said, what).toMatchObject({ reason });
      expect((said as { message: string }).message).toMatch(words);
    });
  }

  it('where a naive reader takes the same bytes', () => {
    // Each of these is read by fflate without a word: the cases a parser differential lives in.
    for (const index of [0, 1, 7, 9, 14]) expect(naiveTakes(cases[index]![1]), cases[index]![0]).toBe(true);
  });

  it('counts the entries before it reads the directory', () => {
    const zip = makeZip([page()], { total: ZIP_MAX_ENTRIES + 1 });
    expect(refusal(zip)).toMatchObject({ reason: 'ZIP_TOO_MANY', message: 'menu.zip has more than 1,000 files and folders.' });
  });
});

describe('an entry’s bytes', () => {
  it('are refused when they inflate to more than the entry declares, or to a different CRC', async () => {
    const big = deflateRawSync(Buffer.alloc(4 * 1024 * 1024));
    const lying = makeZip([page({ name: 'x.js', stored: big, size: 1024, crc: 0 })]);
    const entry = readZipDirectory(lying, 'bomb.zip')[0]!;
    await expect(readZipEntry(lying, entry, 'bomb.zip')).rejects.toMatchObject({ reason: 'ZIP_DAMAGED', message: 'bomb.zip is damaged: x.js does not match its own size or checksum.' });
    const wrongCrc = makeZip([page({ crc: 12345 })]);
    await expect(readZipEntry(wrongCrc, readZipDirectory(wrongCrc, 'a.zip')[0]!, 'a.zip')).rejects.toMatchObject({ reason: 'ZIP_DAMAGED' });
    // A naive reader inflates the bomb whole.
    expect(naiveTakes(lying)).toBe(true);
  });

  it('are inflated off the event loop: a timer keeps ticking while a large entry inflates', async () => {
    const raw = Buffer.alloc(20 * 1024 * 1024, 0x61);
    const zip = makeZip([page({ name: 'big.js', data: raw })]);
    const entry = readZipDirectory(zip, 'big.zip')[0]!;
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 1);
    try {
      expect((await readZipEntry(zip, entry, 'big.zip')).length).toBe(raw.length);
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });
});
