// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A zip, read by its own written rules: a site template a person drops on the Designer.
 *
 * Two readers that disagree about one zip are how a bad path or a bad size gets past a check, so
 * this one reads only what it can classify with certainty and refuses the whole zip otherwise:
 *
 * - The end record is the last one, its comment runs exactly to the end of the file and holds no
 *   second end record. No ZIP64 record of any kind (a locator, a 0xFFFF / 0xFFFFFFFF field, extra
 *   field 0x0001): 25 MB never needs one. One disk only. At most 1,000 entries, counted before the
 *   directory is read. The directory ends where the end record starts.
 * - Sizes and checksums come from the central directory. Each local header matches its directory
 *   entry in name bytes, method and flags; its sizes and checksum equal the directory's, or are zero
 *   when bit 3 says a descriptor follows (macOS writes one for every file), and that descriptor, when
 *   read, equals the directory's values too.
 * - The entries' bytes start at the first byte, lie one after the other with nothing between or
 *   over each other, and end where the directory starts: no self-extracting prefix, no entry inside
 *   another (an overlapping-entry bomb).
 * - Names are strict UTF-8 when bit 11 says so, plain ASCII otherwise; the Unicode-path extra field
 *   is ignored. Encryption (bit 0, bit 6, method 99) is refused; only stored and deflate are read.
 * - A link is known by its mode bits only when the zip says it was made on Unix.
 *
 * An entry is inflated off the event loop (`zlib.inflateRaw`, on the thread pool), from exactly its
 * compressed bytes, with `maxOutputLength` its declared size, then its length and CRC are checked.
 * What to keep, and how much, is the judge's (`judge.ts`); this file never decides it.
 */
import { promisify } from 'node:util';
import { crc32, inflateRaw, type ZlibOptions } from 'node:zlib';

const inflate = promisify(inflateRaw) as (buffer: Buffer, options: ZlibOptions) => Promise<Buffer>;

/** The most a zip a person drops may be. */
export const ZIP_MAX_BYTES = 25 * 1024 * 1024;
/** The most entries a zip may hold, junk and folders included. */
export const ZIP_MAX_ENTRIES = 1000;

export type ZipRefusalReason = 'NOT_A_ZIP' | 'ZIP_FORM' | 'ZIP_TOO_MANY' | 'ZIP_ENCRYPTED' | 'ZIP_METHOD' | 'ZIP_DAMAGED' | 'ZIP_EMPTY';

/** A zip this reader will not read, with the sentence the person reads. */
export class ZipRefusal extends Error {
  override readonly name = 'ZipRefusal';
  constructor(
    readonly reason: ZipRefusalReason,
    message: string,
  ) {
    super(message);
  }
}

export interface ZipEntry {
  /** The name as the zip spells it: folders by `/`, a folder's own entry ending in one. */
  name: string;
  method: 0 | 8;
  flags: number;
  crc: number;
  compressedSize: number;
  /** Its size once inflated, as the directory declares it. */
  size: number;
  /** Where its local header starts, and where its bytes start and end (a descriptor after them is not counted). */
  offset: number;
  dataStart: number;
  dataEnd: number;
  /** A link and anything that is not a file or a folder are never read. */
  type: 'file' | 'dir' | 'link' | 'other';
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;
const END = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

const form = (zip: string, why: string): ZipRefusal => new ZipRefusal('ZIP_FORM', `${zip} is made in a way this reader does not take (${why}). Make the zip again from the folder.`);

/** Whether a run of extra fields names a ZIP64 one; a run that does not add up is not one this reader takes. */
function extraHasZip64(extra: Buffer, zip: string): boolean {
  let at = 0;
  while (at < extra.length) {
    if (at + 4 > extra.length) throw form(zip, 'a file has a broken extra field');
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (at + 4 + size > extra.length) throw form(zip, 'a file has a broken extra field');
    if (id === 0x0001) return true;
    at += 4 + size;
  }
  return false;
}

/** A name, strictly: UTF-8 when the zip says so, plain ASCII otherwise. */
function nameOf(bytes: Buffer, utf8: boolean, zip: string): string {
  if (utf8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw form(zip, 'a file name is not the UTF-8 it says it is');
    }
  }
  if (bytes.some((byte) => byte >= 0x80)) throw form(zip, 'a file name is in an old encoding, not UTF-8');
  return bytes.toString('latin1');
}

/** The entries of a zip, by the rules above. Reads no entry's bytes. */
export function readZipDirectory(zip: Buffer, label: string): ZipEntry[] {
  if (zip.length > ZIP_MAX_BYTES) throw new ZipRefusal('ZIP_FORM', `${label} is over 25 MB.`);
  const notZip = new ZipRefusal('NOT_A_ZIP', `${label} is not a zip file that can be read.`);
  if (zip.length < 22) throw notZip;
  // The end record: the one whose comment runs exactly to the end. Two that could be it are one too many.
  const ends: number[] = [];
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === SIG_END && at + 22 + zip.readUInt16LE(at + 20) === zip.length) ends.push(at);
  }
  const end = ends[ends.length - 1] ?? -1;
  if (end < 0) throw notZip;
  if (ends.length > 1 || zip.subarray(end + 22).includes(END)) throw form(label, 'its comment holds a second end record');
  if (end >= 20 && zip.readUInt32LE(end - 20) === SIG_END64_LOCATOR) throw form(label, 'it is a ZIP64 file');
  const disk = zip.readUInt16LE(end + 4);
  const directoryDisk = zip.readUInt16LE(end + 6);
  const onDisk = zip.readUInt16LE(end + 8);
  const total = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  const directoryAt = zip.readUInt32LE(end + 16);
  if ([disk, directoryDisk, onDisk, total].includes(0xffff) || directorySize === 0xffffffff || directoryAt === 0xffffffff) throw form(label, 'it is a ZIP64 file');
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== total) throw form(label, 'it is split over several disks');
  // Counted before the directory is read.
  if (total > ZIP_MAX_ENTRIES) throw new ZipRefusal('ZIP_TOO_MANY', `${label} has more than ${ZIP_MAX_ENTRIES.toLocaleString('en-US')} files and folders.`);
  if (total === 0) throw new ZipRefusal('ZIP_EMPTY', `${label} is empty.`);
  if (directoryAt + directorySize !== end) throw form(label, 'its directory is not where it says');

  const entries: (ZipEntry & { end: number })[] = [];
  let at = directoryAt;
  for (let index = 0; index < total; index += 1) {
    if (at + 46 > end || zip.readUInt32LE(at) !== SIG_CENTRAL) throw form(label, 'its directory is broken');
    const madeBy = zip.readUInt16LE(at + 4);
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const startDisk = zip.readUInt16LE(at + 34);
    const external = zip.readUInt32LE(at + 38);
    const offset = zip.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw form(label, 'its directory is broken');
    const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
    const extra = zip.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff || startDisk === 0xffff || extraHasZip64(extra, label)) throw form(label, 'it is a ZIP64 file');
    if (startDisk !== 0) throw form(label, 'it is split over several disks');
    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0 || method === 99) throw new ZipRefusal('ZIP_ENCRYPTED', `${label} is locked with a password, so it cannot be read.`);
    if (method !== 0 && method !== 8) throw new ZipRefusal('ZIP_METHOD', `${label} is compressed in a way this reader does not take (only stored and deflate).`);
    const name = nameOf(nameBytes, (flags & 0x800) !== 0, label);
    if (name.length === 0) throw form(label, 'a file has no name');
    if (method === 0 && compressedSize !== size) throw new ZipRefusal('ZIP_DAMAGED', `${label} is damaged: ${name} does not match its own size.`);

    // What it is: a link only by Unix mode bits, and only when the zip was made on Unix.
    let type: ZipEntry['type'] = name.endsWith('/') ? 'dir' : 'file';
    if (madeBy >> 8 === 3) {
      const kind = (external >>> 16) & 0o170000;
      if (kind === 0o120000) type = 'link';
      else if (kind === 0o040000) type = 'dir';
      else if (kind !== 0o100000 && kind !== 0) type = 'other';
    }
    if (type === 'dir' && (size !== 0 || !name.endsWith('/'))) throw form(label, 'a folder holds bytes');

    // The local header, checked against the directory.
    if (offset + 30 > directoryAt || zip.readUInt32LE(offset) !== SIG_LOCAL) throw form(label, "a file's two headers disagree");
    const localFlags = zip.readUInt16LE(offset + 6);
    const localMethod = zip.readUInt16LE(offset + 8);
    const localCrc = zip.readUInt32LE(offset + 14);
    const localCompressed = zip.readUInt32LE(offset + 18);
    const localSize = zip.readUInt32LE(offset + 22);
    const localNameLength = zip.readUInt16LE(offset + 26);
    const localExtraLength = zip.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    if (dataStart > directoryAt) throw form(label, "a file's two headers disagree");
    if (localFlags !== flags || localMethod !== method || !zip.subarray(offset + 30, offset + 30 + localNameLength).equals(nameBytes)) throw form(label, "a file's two headers disagree");
    if (extraHasZip64(zip.subarray(offset + 30 + localNameLength, dataStart), label)) throw form(label, 'it is a ZIP64 file');
    const described = (flags & 0x8) !== 0;
    const agrees = (local: number, central: number): boolean => local === central || (described && local === 0);
    if (!agrees(localCrc, crc) || !agrees(localCompressed, compressedSize) || !agrees(localSize, size)) throw form(label, "a file's two headers disagree");
    const dataEnd = dataStart + compressedSize;
    let entryEnd = dataEnd;
    if (described) {
      // A descriptor, with or without its signature; either way it says what the directory says.
      const matches = (from: number): boolean => from + 12 <= directoryAt && zip.readUInt32LE(from) === crc && zip.readUInt32LE(from + 4) === compressedSize && zip.readUInt32LE(from + 8) === size;
      if (dataEnd + 4 <= directoryAt && zip.readUInt32LE(dataEnd) === SIG_DESCRIPTOR && matches(dataEnd + 4)) entryEnd = dataEnd + 16;
      else if (matches(dataEnd)) entryEnd = dataEnd + 12;
      else throw form(label, "a file's descriptor disagrees with its header");
    }
    if (entryEnd > directoryAt) throw form(label, 'a file runs into the directory');
    entries.push({ name, method, flags, crc, compressedSize, size, offset, dataStart, dataEnd, type, end: entryEnd });
    at = next;
  }
  if (at !== end) throw form(label, 'its directory is broken');

  // The entries' bytes: from the first byte, one after another, to the directory.
  const byPlace = [...entries].sort((a, b) => a.offset - b.offset);
  let expect = 0;
  for (const entry of byPlace) {
    if (entry.offset < expect) throw form(label, 'two files share bytes');
    if (entry.offset > expect) throw form(label, expect === 0 ? 'it has data before its first file' : 'it has bytes between its files');
    expect = entry.end;
  }
  if (expect !== directoryAt) throw form(label, 'it has bytes between its files');
  return entries.map(({ end: _end, ...entry }) => entry);
}

/** One entry's bytes: inflated off the event loop, no more than it declares, and checked. */
export async function readZipEntry(zip: Buffer, entry: ZipEntry, label: string): Promise<Buffer> {
  const damaged = (): ZipRefusal => new ZipRefusal('ZIP_DAMAGED', `${label} is damaged: ${entry.name} does not match its own size or checksum.`);
  const data = zip.subarray(entry.dataStart, entry.dataEnd);
  let bytes: Buffer;
  if (entry.method === 0) bytes = Buffer.from(data);
  else {
    try {
      bytes = await inflate(data, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw damaged();
    }
  }
  if (bytes.length !== entry.size || crc32(bytes) >>> 0 !== entry.crc) throw damaged();
  return bytes;
}
