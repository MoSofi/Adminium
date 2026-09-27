// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Small pictures built byte by byte, each carrying what a camera or an editor
 * writes beside the image (a place, a comment, XMP), for the tests of what a
 * public picture is cleaned of.
 */
import { crc32, deflateSync } from 'node:zlib';

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16be = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u16le = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.from(type, 'latin1');
  return Buffer.concat([u32(data.length), head, data, u32(crc32(Buffer.concat([head, data])))]);
}

/** A PNG of one colour, `width` × `height`, with a text chunk and an Exif chunk when asked. */
export function png(opts: { width?: number; height?: number; text?: string; exif?: boolean; fill?: number } = {}): { bytes: Buffer; clean: Buffer } {
  const width = opts.width ?? 2;
  const height = opts.height ?? 2;
  const ihdr = pngChunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]));
  const rows = height <= 64 && width <= 64 ? Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, opts.fill ?? 200)]))) : Buffer.from([0, 0, 0, 0]);
  const idat = pngChunk('IDAT', deflateSync(rows));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const extras = [
    ...(opts.text === undefined ? [] : [pngChunk('tEXt', Buffer.from(`Comment\0${opts.text}`, 'latin1'))]),
    ...(opts.exif === true ? [pngChunk('eXIf', Buffer.from('MM\0*GPSLatitude 51.5074 N', 'latin1'))] : []),
  ];
  return { bytes: Buffer.concat([sig, ihdr, ...extras, idat, iend]), clean: Buffer.concat([sig, ihdr, idat, iend]) };
}

const segment = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), u16be(data.length + 2), data]);

/** A JPEG's blocks (not an image a decoder draws: the blocks are what the cleaning reads), with Exif GPS and a comment. */
export function jpeg(opts: { width?: number; height?: number } = {}): { bytes: Buffer; clean: Buffer } {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
  const app1 = segment(0xe1, Buffer.from('Exif\0\0MM\0*GPSLatitude 51.5074 N GPSLongitude 0.1278 W', 'latin1'));
  const app2 = segment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01profile', 'latin1'));
  const com = segment(0xfe, Buffer.from('taken in the kitchen at 14 Elm Row', 'latin1'));
  const app13 = segment(0xed, Buffer.from('Photoshop 3.0\0IPTC', 'latin1'));
  const dqt = segment(0xdb, Buffer.alloc(65, 1));
  const sof = segment(0xc0, Buffer.concat([Buffer.from([8]), u16be(opts.height ?? 8), u16be(opts.width ?? 8), Buffer.from([1, 1, 0x11, 0])]));
  const dht = segment(0xc4, Buffer.alloc(20, 0));
  const sos = segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
  const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
  return {
    bytes: Buffer.concat([soi, app0, app1, app2, com, app13, dqt, sof, dht, sos, scan]),
    clean: Buffer.concat([soi, app0, app2, dqt, sof, dht, sos, scan]),
  };
}

const riffChunk = (fourcc: string, data: Buffer) => Buffer.concat([Buffer.from(fourcc, 'latin1'), u32le(data.length), data, data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
const riff = (chunks: Buffer[]) => {
  const body = Buffer.concat(chunks);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(4 + body.length), Buffer.from('WEBP', 'latin1'), body]);
};

/** An extended WebP with a lossless frame, a colour profile, Exif and XMP. */
export function webp(opts: { width?: number; height?: number } = {}): { bytes: Buffer; clean: Buffer } {
  const width = opts.width ?? 100;
  const height = opts.height ?? 50;
  const vp8x = (flags: number) => {
    const d = Buffer.alloc(10);
    d[0] = flags;
    d.writeUIntLE(width - 1, 4, 3);
    d.writeUIntLE(height - 1, 7, 3);
    return d;
  };
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const vp8l = Buffer.concat([Buffer.from([0x2f]), u32le(bits), Buffer.from([0, 0, 0])]);
  const iccp = riffChunk('ICCP', Buffer.from('profile', 'latin1'));
  const frame = riffChunk('VP8L', vp8l);
  return {
    bytes: riff([riffChunk('VP8X', vp8x(0x20 | 0x08 | 0x04)), iccp, frame, riffChunk('EXIF', Buffer.from('MM\0*GPSLatitude 51.5', 'latin1')), riffChunk('XMP ', Buffer.from('<x:xmpmeta/>', 'latin1'))]),
    clean: riff([riffChunk('VP8X', vp8x(0x20)), iccp, frame]),
  };
}

const gifExtension = (label: number, blocks: Buffer[]) => Buffer.concat([Buffer.from([0x21, label]), ...blocks.map((b) => Buffer.concat([Buffer.from([b.length]), b])), Buffer.from([0])]);

/** An animated GIF's blocks: its loop kept, a comment and an XMP block gone. */
export function gif(opts: { width?: number; height?: number } = {}): { bytes: Buffer; clean: Buffer } {
  const head = Buffer.concat([Buffer.from('GIF89a', 'latin1'), u16le(opts.width ?? 10), u16le(opts.height ?? 10), Buffer.from([0x80, 0, 0]), Buffer.from([0, 0, 0, 255, 255, 255])]);
  const loop = gifExtension(0xff, [Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([1, 0, 0])]);
  const comment = gifExtension(0xfe, [Buffer.from('made at 14 Elm Row', 'latin1')]);
  const xmp = gifExtension(0xff, [Buffer.from('XMP DataXMP', 'latin1'), Buffer.from('<x:xmpmeta/>', 'latin1')]);
  const control = gifExtension(0xf9, [Buffer.from([0, 0, 0, 0])]);
  const image = Buffer.concat([Buffer.from([0x2c]), u16le(0), u16le(0), u16le(10), u16le(10), Buffer.from([0]), Buffer.from([2, 2, 0x4c, 0x01, 0])]);
  const trailer = Buffer.from([0x3b]);
  return { bytes: Buffer.concat([head, loop, comment, xmp, control, image, trailer]), clean: Buffer.concat([head, loop, control, image, trailer]) };
}
