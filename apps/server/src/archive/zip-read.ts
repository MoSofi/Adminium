// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A zip reader for archives that are not trusted.
 *
 * Written here rather than taken from fflate because a restore needs three
 * things fflate's readers do not give: the central directory's file modes (a
 * symlink entry must be refused, not unpacked as a file holding its target),
 * random access (the manifest and its signature are read and checked before a
 * single other byte is inflated), and inflating a member to a FILE with a hard
 * stop one byte past the size the signed manifest promised, so neither a zip
 * bomb nor a lying header can fill the disk or the heap.
 *
 * What it refuses, before reading any data: zip64 (fflate, which writes these
 * archives, never makes one), encrypted members, any compression but stored
 * and deflate, a member that is not a regular file (directory, symlink, device),
 * a name that fails {@link isSafeArchivePath}, a duplicate name, and more
 * members than {@link ARCHIVE_LIMITS.entries}.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

import { ARCHIVE_LIMITS, ARCHIVE_MANIFEST, ArchiveFormatError, isSafeArchivePath } from './format.js';

export interface ZipMember {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Where the member's local header starts. */
  offset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

function refuse(message: string): never {
  throw new ArchiveFormatError(`This is not a readable Adminium archive: ${message}.`);
}

export class ZipReader {
  private constructor(
    private readonly handle: FileHandle,
    readonly members: ReadonlyMap<string, ZipMember>,
  ) {}

  static async open(path: string): Promise<ZipReader> {
    const handle = await open(path, 'r');
    try {
      const members = await readCentralDirectory(handle);
      return new ZipReader(handle, members);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  private member(name: string): ZipMember {
    const member = this.members.get(name);
    if (member === undefined) refuse(`${name} is missing`);
    return member;
  }

  /** Where a member's bytes start, after its local header. */
  private async dataStart(member: ZipMember): Promise<number> {
    const header = Buffer.alloc(30);
    const { bytesRead } = await this.handle.read(header, 0, 30, member.offset);
    if (bytesRead !== 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) refuse(`${member.name} has no local header`);
    return member.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  }

  /** A small member, whole, in memory. Refused past `maxBytes`. */
  async readBuffer(name: string, maxBytes: number): Promise<Buffer> {
    const member = this.member(name);
    if (member.size > maxBytes || member.compressedSize > maxBytes) refuse(`${name} is larger than ${String(maxBytes)} bytes`);
    const start = await this.dataStart(member);
    const raw = Buffer.alloc(member.compressedSize);
    const { bytesRead } = await this.handle.read(raw, 0, member.compressedSize, start);
    if (bytesRead !== member.compressedSize) refuse(`${name} is cut short`);
    if (member.method === 0) {
      if (raw.length !== member.size) refuse(`${name} is not the size its header says`);
      return raw;
    }
    let out: Buffer;
    try {
      out = inflateRawSync(raw, { maxOutputLength: maxBytes });
    } catch {
      refuse(`${name} does not inflate`);
    }
    if (out.length !== member.size) refuse(`${name} is not the size its header says`);
    return out;
  }

  /**
   * Inflate a member into `dest` (created, never overwritten), checking it is
   * exactly `bytes` long with digest `sha256`. The stream stops one byte past
   * `bytes`, whatever the headers claimed.
   */
  async extractTo(name: string, dest: string, expected: { bytes: number; sha256: string }): Promise<void> {
    const member = this.member(name);
    if (member.size !== expected.bytes) refuse(`${name} is not the size the manifest says`);
    const start = await this.dataStart(member);
    const source =
      member.compressedSize === 0
        ? Readable.from([])
        : this.handle.createReadStream({ start, end: start + member.compressedSize - 1, autoClose: false });
    const hash = createHash('sha256');
    let seen = 0;
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        seen += chunk.length;
        if (seen > expected.bytes) {
          done(new ArchiveFormatError(`This is not a readable Adminium archive: ${name} is larger than the manifest says.`));
          return;
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });
    const stages = member.method === 0 ? [source, guard] : [source, createInflateRaw(), guard];
    try {
      await pipeline([...stages, createWriteStream(dest, { flags: 'wx', mode: 0o600 })]);
    } catch (error) {
      if (error instanceof ArchiveFormatError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
      refuse(`${name} does not inflate`);
    }
    if (seen !== expected.bytes || hash.digest('hex') !== expected.sha256) {
      throw new ArchiveFormatError(`This archive was changed after it was made: ${name} does not match its manifest.`);
    }
  }
}

async function readCentralDirectory(handle: FileHandle): Promise<Map<string, ZipMember>> {
  const { size } = await handle.stat();
  if (size < 22) refuse('the file is too short');
  if (size > ARCHIVE_LIMITS.totalBytes + 64 * 1024 ** 2) refuse('the file is larger than an archive can be');
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = Buffer.alloc(tailLength);
  await handle.read(tail, 0, tailLength, size - tailLength);
  let eocd = -1;
  for (let at = tailLength - 22; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) refuse('it has no zip directory');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) refuse('zip64 archives are not read');
  if (count > ARCHIVE_LIMITS.entries) refuse(`it holds more than ${String(ARCHIVE_LIMITS.entries)} members`);
  if (cdOffset + cdSize > size) refuse('its directory points past the end of the file');

  const cd = Buffer.alloc(cdSize);
  await handle.read(cd, 0, cdSize, cdOffset);
  const members = new Map<string, ZipMember>();
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > cd.length || cd.readUInt32LE(at) !== CENTRAL_SIGNATURE) refuse('its directory is damaged');
    const madeBy = cd.readUInt16LE(at + 4) >> 8;
    const flags = cd.readUInt16LE(at + 8);
    const method = cd.readUInt16LE(at + 10);
    const compressedSize = cd.readUInt32LE(at + 20);
    const memberSize = cd.readUInt32LE(at + 24);
    const nameLength = cd.readUInt16LE(at + 28);
    const extraLength = cd.readUInt16LE(at + 30);
    const commentLength = cd.readUInt16LE(at + 32);
    const external = cd.readUInt32LE(at + 38);
    const offset = cd.readUInt32LE(at + 42);
    if (at + 46 + nameLength > cd.length) refuse('its directory is damaged');
    const name = cd.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;

    if ((flags & 1) !== 0) refuse(`${name} is encrypted`);
    if (method !== 0 && method !== 8) refuse(`${name} uses an unknown compression`);
    if (compressedSize === 0xffffffff || memberSize === 0xffffffff || offset === 0xffffffff) refuse('zip64 archives are not read');
    if (!isSafeArchivePath(name)) refuse(`the member name ${JSON.stringify(name.slice(0, 120))} is not allowed`);
    // Unix-made entries carry their mode in the high 16 bits. Anything but a
    // regular file (a symlink above all) is refused; the writer makes none.
    const mode = external >>> 16;
    if (madeBy === 3 && mode !== 0 && (mode & S_IFMT) !== S_IFREG) refuse(`${name} is not a regular file`);
    if ((external & 0x10) !== 0) refuse(`${name} is a directory`);
    if (offset + 30 > size) refuse(`${name} points past the end of the file`);
    if (members.has(name)) refuse(`${name} appears twice`);
    members.set(name, { name, method, compressedSize, size: memberSize, offset });
  }
  return members;
}

/** Whether `path` is an instance archive or export (`adminium archive create`), by its manifest member. */
export async function isInstanceArchive(path: string): Promise<boolean> {
  let zip: ZipReader;
  try {
    zip = await ZipReader.open(path);
  } catch {
    return false;
  }
  try {
    return zip.members.has(ARCHIVE_MANIFEST);
  } finally {
    await zip.close();
  }
}
