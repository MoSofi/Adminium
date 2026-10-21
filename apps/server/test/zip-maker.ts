// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zips made byte by byte for tests: well made, as macOS makes them, and broken in each way a zip
 * reader has to refuse. Every field a reader checks can be set to a lie.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipPart {
  name: string;
  data?: Buffer | string;
  method?: number;
  /** Added to the flags made (bit 11 is set for a name that is not ASCII unless `ascii` says not to). */
  flags?: number;
  ascii?: boolean;
  /** The name's bytes as written, instead of the name in UTF-8. */
  nameBytes?: Buffer;
  /** "Version made by": 0x031e is Unix (the default), 0x0014 is MS-DOS. */
  madeBy?: number;
  /** Unix mode bits, written in the external attributes' high half. */
  mode?: number;
  /** A data descriptor after the bytes: with its signature, or without. */
  descriptor?: 'signed' | 'bare';
  localName?: string;
  localFlags?: number;
  localMethod?: number;
  /** What the directory says, when it should lie. */
  size?: number;
  compressedSize?: number;
  crc?: number;
  localSize?: number;
  localCrc?: number;
  descriptorCrc?: number;
  extraCentral?: Buffer;
  extraLocal?: Buffer;
  /** This entry's directory record points at another entry's local header. */
  pointsAt?: number;
  /** The bytes as stored, instead of the data deflated. */
  stored?: Buffer;
}

export interface ZipShape {
  prefix?: Buffer;
  /** Bytes between the first entry and the second. */
  between?: Buffer;
  comment?: Buffer;
  zip64Locator?: boolean;
  disk?: number;
  /** The entry count the end record says. */
  total?: number;
}

const u16 = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff);
  return out;
};
const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
};

export function makeZip(parts: readonly ZipPart[], shape: ZipShape = {}): Buffer {
  const locals: Buffer[] = [];
  const offsets: number[] = [];
  const centrals: Buffer[] = [];
  let at = shape.prefix?.length ?? 0;
  if (shape.prefix !== undefined) locals.push(shape.prefix);
  parts.forEach((part, index) => {
    const raw = typeof part.data === 'string' ? Buffer.from(part.data) : (part.data ?? Buffer.alloc(0));
    const method = part.method ?? 8;
    const body = part.stored ?? (method === 8 ? deflateRawSync(raw) : raw);
    const name = part.nameBytes ?? Buffer.from(part.name, 'utf8');
    const utf8 = part.ascii !== true && /[^\x00-\x7f]/.test(part.name) ? 0x800 : 0;
    const flags = utf8 | (part.descriptor === undefined ? 0 : 0x8) | (part.flags ?? 0);
    const crc = part.crc ?? crc32(raw);
    const size = part.size ?? raw.length;
    const compressed = part.compressedSize ?? body.length;
    const localName = part.localName === undefined ? name : Buffer.from(part.localName, 'utf8');
    const described = part.descriptor !== undefined;
    const extraLocal = part.extraLocal ?? Buffer.alloc(0);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(part.localFlags ?? flags),
      u16(part.localMethod ?? method),
      u16(0),
      u16(0x21),
      u32(described ? 0 : (part.localCrc ?? crc)),
      u32(described ? 0 : compressed),
      u32(described ? 0 : (part.localSize ?? size)),
      u16(localName.length),
      u16(extraLocal.length),
      localName,
      extraLocal,
      body,
      ...(part.descriptor === 'signed' ? [u32(0x08074b50)] : []),
      ...(described ? [u32(part.descriptorCrc ?? crc), u32(compressed), u32(size)] : []),
    ]);
    if (index === 1 && shape.between !== undefined) {
      locals.push(shape.between);
      at += shape.between.length;
    }
    offsets.push(at);
    locals.push(local);
    at += local.length;
    const extraCentral = part.extraCentral ?? Buffer.alloc(0);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(part.madeBy ?? 0x031e),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0x21),
        u32(crc),
        u32(compressed),
        u32(size),
        u16(name.length),
        u16(extraCentral.length),
        u16(0),
        u16(0),
        u16(0),
        u32(((part.mode ?? (part.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0),
        u32(0),
        name,
        extraCentral,
      ]),
    );
  });
  // The directory's offsets, now that every local header has its place.
  centrals.forEach((central, index) => central.writeUInt32LE(offsets[parts[index]?.pointsAt ?? index] ?? 0, 42));
  const directory = Buffer.concat(centrals);
  const comment = shape.comment ?? Buffer.alloc(0);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(shape.disk ?? 0),
    u16(shape.disk ?? 0),
    u16(shape.total ?? parts.length),
    u16(shape.total ?? parts.length),
    u32(directory.length),
    u32(at),
    u16(comment.length),
    comment,
  ]);
  const locator = shape.zip64Locator === true ? Buffer.concat([u32(0x07064b50), Buffer.alloc(16)]) : Buffer.alloc(0);
  return Buffer.concat([...locals, directory, locator, end]);
}
