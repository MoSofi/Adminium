// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The spool and the sniffing gate.
 *
 * The sniff table is exercised from real byte heads rather than from mime
 * strings, because the whole point of the gate is that the client's claim is
 * advisory: a test that fed it `content-type` would prove nothing it is for.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSpool, SpoolTooLargeError, TMP_DIR } from '../src/files/spool.js';
import { extensionOf, mimesForKeys, sniff, SNIFF_HEAD_BYTES } from '../src/files/sniff.js';

/** Pad a signature out so length-sensitive branches see a realistic head. */
function head(...parts: (string | number[])[]): Buffer {
  const bytes = parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Buffer.concat([Buffer.from(bytes), Buffer.alloc(64)]);
}

describe('sniff — the signature table', () => {
  const cases: { name: string; bytes: Buffer; filename: string; key: string; mime: string }[] = [
    { name: 'PDF', bytes: head('%PDF-1.7\n'), filename: 'inv.pdf', key: 'pdf', mime: 'application/pdf' },
    { name: 'PNG', bytes: head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filename: 'a.png', key: 'png', mime: 'image/png' },
    { name: 'JPEG', bytes: head([0xff, 0xd8, 0xff, 0xe0]), filename: 'a.jpg', key: 'jpeg', mime: 'image/jpeg' },
    { name: 'GIF', bytes: head('GIF89a'), filename: 'a.gif', key: 'gif', mime: 'image/gif' },
    { name: 'WebP', bytes: head('RIFF', [0, 0, 0, 0], 'WEBP'), filename: 'a.webp', key: 'webp', mime: 'image/webp' },
    { name: 'WAV', bytes: head('RIFF', [0, 0, 0, 0], 'WAVE'), filename: 'a.wav', key: 'wav', mime: 'audio/wav' },
    { name: 'HEIC', bytes: head([0, 0, 0, 0x18], 'ftypheic'), filename: 'a.heic', key: 'heic', mime: 'image/heic' },
    { name: 'MP4', bytes: head([0, 0, 0, 0x18], 'ftypisom'), filename: 'a.mp4', key: 'mp4', mime: 'video/mp4' },
    { name: 'MOV', bytes: head([0, 0, 0, 0x14], 'ftypqt  '), filename: 'a.mov', key: 'mp4', mime: 'video/quicktime' },
    { name: 'MP3 (ID3)', bytes: head('ID3', [3, 0]), filename: 'a.mp3', key: 'mp3', mime: 'audio/mpeg' },
    { name: 'MP3 (frame sync)', bytes: head([0xff, 0xfb, 0x90]), filename: 'a.mp3', key: 'mp3', mime: 'audio/mpeg' },
    { name: 'WebM', bytes: head([0x1a, 0x45, 0xdf, 0xa3]), filename: 'a.webm', key: 'webm', mime: 'video/webm' },
    { name: 'Ogg', bytes: head('OggS'), filename: 'a.ogg', key: 'ogg', mime: 'audio/ogg' },
  ];

  for (const c of cases) {
    it(`identifies ${c.name} from its head`, () => {
      const result = sniff(c.bytes, c.filename);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.type.key).toBe(c.key);
      expect(result.type.mime).toBe(c.mime);
    });
  }

  it('tells an OOXML package from a plain zip by the entry names in its head', () => {
    // `PK\x03\x04`, 22 bytes of local header, a 19-char name at offset 26/30.
    const local = Buffer.alloc(30);
    local.write('PK\x03\x04', 0, 'latin1');
    local.writeUInt16LE('[Content_Types].xml'.length, 26);
    const docx = Buffer.concat([local, Buffer.from('[Content_Types].xml'), Buffer.from('....word/document.xml....')]);
    const xlsx = Buffer.concat([local, Buffer.from('[Content_Types].xml'), Buffer.from('....xl/workbook.xml....')]);
    const plain = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(60)]);

    const asDocx = sniff(docx, 'report.docx');
    expect(asDocx.ok && asDocx.type.ext).toBe('docx');
    const asXlsx = sniff(xlsx, 'sheet.xlsx');
    expect(asXlsx.ok && asXlsx.type.ext).toBe('xlsx');
    const asZip = sniff(plain, 'bundle.zip');
    expect(asZip.ok && asZip.type.key).toBe('zip');
  });

  it('accepts SVG behind a prologue, a comment and a doctype', () => {
    const svg = Buffer.from('<?xml version="1.0"?>\n<!-- drawn by hand -->\n<svg xmlns="http://www.w3.org/2000/svg"/>');
    const result = sniff(svg, 'logo.svg');
    expect(result.ok && result.type.mime).toBe('image/svg+xml');
    // Markup that is not a legal prologue is not an SVG.
    expect(sniff(Buffer.from('<html><svg/></html>'), 'x.svg').ok).toBe(false);
  });

  it('names the sniffed type when a PDF arrives called .png (the mismatch case)', () => {
    // The client's claim is advisory; the STORED type is what the bytes say.
    const result = sniff(head('%PDF-1.4'), 'totally-an-image.png');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.type.mime).toBe('application/pdf');
    // The route refuses this when a column's `accept` says images — the gate's
    // job here is to report the truth, which it does.
  });

  it('admits text kinds by extension only when the head is valid UTF-8', () => {
    const csv = sniff(Buffer.from('id,name\n1,Ada é\n'), 'orders.csv');
    expect(csv.ok && csv.type.mime).toBe('text/csv');

    // Latin-1 bytes that are not valid UTF-8.
    const bad = sniff(Buffer.from([0x69, 0x64, 0xff, 0xfe, 0x0a]), 'orders.csv');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.refusal.reason).toBe('not-text');

    // A NUL is the classic "binary wearing a .txt".
    expect(sniff(Buffer.from([0x68, 0x00, 0x69]), 'notes.txt').ok).toBe(false);
  });

  it('does not trim a multi-byte character straddling the head boundary into a refusal', () => {
    // Fill exactly to the cap, ending mid-character.
    const filler = Buffer.from('a'.repeat(SNIFF_HEAD_BYTES - 1));
    const straddled = Buffer.concat([filler, Buffer.from('é', 'utf8').subarray(0, 1)]);
    expect(straddled.length).toBe(SNIFF_HEAD_BYTES);
    expect(sniff(straddled, 'notes.txt').ok).toBe(true);
  });

  it('refuses unknown content and an empty body, naming what it saw', () => {
    const unknown = sniff(Buffer.from([0x01, 0x02, 0x03, 0x04]), 'mystery.bin');
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.refusal.detail).toContain('0x01020304');

    const empty = sniff(Buffer.alloc(0), 'nothing.pdf');
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.refusal.detail).toContain('empty');
  });

  it('extracts extensions the way the text table expects', () => {
    expect(extensionOf('a/b/orders.CSV')).toBe('csv');
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('reports the mimes a narrowed allowlist can produce', () => {
    expect(mimesForKeys(['pdf'])).toEqual(['application/pdf']);
    expect(mimesForKeys(['png', 'jpeg'])).toEqual(['image/jpeg', 'image/png']);
    expect(mimesForKeys(['office'])).toHaveLength(3);
  });
});

describe('spool', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'adminium-spool-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('drains a stream, measures it, and holds the head for the gate', async () => {
    const spool = createSpool({ dataDir });
    const body = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(40_000)]);
    const file = await spool.spool(Readable.from([body.subarray(0, 1000), body.subarray(1000)]), { maxBytes: 1_000_000 });

    expect(file.sizeBytes).toBe(body.byteLength);
    expect(file.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(file.head).toHaveLength(SNIFF_HEAD_BYTES);
    expect(file.head.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await stat(file.path)).size).toBe(body.byteLength);

    await file.release();
    await expect(stat(file.path)).rejects.toThrow();
    // Idempotent — the driver may already have taken the bytes by rename.
    await file.release();
  });

  it('aborts one byte over the cap and leaves nothing behind', async () => {
    const spool = createSpool({ dataDir });
    const body = randomBytes(1025);
    await expect(spool.spool(Readable.from([body]), { maxBytes: 1024 })).rejects.toBeInstanceOf(SpoolTooLargeError);

    // The spool file is gone, not merely closed — the cap fires BEFORE commit.
    expect(await readdir(join(dataDir, TMP_DIR))).toEqual([]);
  });

  it('stops reading rather than buffering the rest of an oversized body', async () => {
    const spool = createSpool({ dataDir });
    let chunksPulled = 0;
    // 100 × 1 KiB against a 2 KiB cap: a correct gate destroys the source after
    // a handful of chunks, a buffering one drains all hundred.
    const source = Readable.from(
      (function* gen() {
        for (let i = 0; i < 100; i += 1) {
          chunksPulled += 1;
          yield randomBytes(1024);
        }
      })(),
    );
    await expect(spool.spool(source, { maxBytes: 2048 })).rejects.toBeInstanceOf(SpoolTooLargeError);
    expect(chunksPulled).toBeLessThan(10);
  });

  it('creates the spool directory 0o700 and its files 0o600', async () => {
    const spool = createSpool({ dataDir });
    const file = await spool.spool(Readable.from([Buffer.from('hello')]), { maxBytes: 1024 });
    expect((await stat(spool.root)).mode & 0o777).toBe(0o700);
    expect((await stat(file.path)).mode & 0o777).toBe(0o600);
    await file.release();
  });

  it('measures an incremental writer identically to a streamed body', async () => {
    const spool = createSpool({ dataDir });
    const pages = ['id,name\n', '1,Ada\n', '2,Grace\n'];
    const writer = await spool.openWriter();
    for (const page of pages) await writer.write(page);
    const file = await writer.close();

    const whole = Buffer.from(pages.join(''));
    expect(file.sizeBytes).toBe(whole.byteLength);
    expect(file.sha256).toBe(createHash('sha256').update(whole).digest('hex'));
    expect(file.head.toString()).toBe(whole.toString());
    await file.release();
  });

  it('abort removes a partially written artifact', async () => {
    const spool = createSpool({ dataDir });
    const writer = await spool.openWriter();
    await writer.write('half a file');
    await writer.abort();
    expect(await readdir(join(dataDir, TMP_DIR))).toEqual([]);
    // Idempotent, so a failure path may abort in a finally without checking.
    await writer.abort();
  });

  it('caps an incremental writer too', async () => {
    const spool = createSpool({ dataDir });
    const writer = await spool.openWriter({ maxBytes: 8 });
    await writer.write('12345678');
    await expect(writer.write('9')).rejects.toBeInstanceOf(SpoolTooLargeError);
    expect(await readdir(join(dataDir, TMP_DIR))).toEqual([]);
  });
});
