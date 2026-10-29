// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture service that calls nothing, for tests and the e2e run. Nothing
 * in Adminium's suites ever asks a real service: a fake agrees
 * with us by construction, so the owner's live smoke run
 * (`pictures.live.smoke.test.ts`) is what proves the real routes.
 *
 * It makes real PNGs (small, one colour, the shape's proportions), so a
 * browser draws them and every check a real answer meets is met. Words with
 * `refuse` in them are refused; `fail` fails; `busy` is a rate limit; `slow`
 * waits a second.
 */
import { MAKE_COUNT_MAX, PictureError, type MakeRequest, type MakeResult, type PictureMaker, type PictureMakerKind, type PictureShape } from './types.js';

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array([...[...type].map((c) => c.charCodeAt(0)), ...data]);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

/** A one-colour PNG of the given size: stored (not compressed) deflate blocks, valid in every browser. */
export function fakePng(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const row = [0, ...Array.from({ length: width }, () => [...rgb]).flat()];
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y += 1) raw.set(row, y * row.length);
  // zlib: a header, stored blocks of at most 65,535 bytes, and the Adler-32 of the raw bytes.
  const blocks: number[] = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 65_535) {
    const piece = raw.subarray(at, at + 65_535);
    const last = at + 65_535 >= raw.length ? 1 : 0;
    blocks.push(last, piece.length & 0xff, piece.length >>> 8, ~piece.length & 0xff, (~piece.length >>> 8) & 0xff, ...piece);
    if (raw.length === 0) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  blocks.push(...u32(((b << 16) | a) >>> 0));
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', new Uint8Array(blocks)), ...chunk('IEND', new Uint8Array())]);
}

const SIZE: Readonly<Record<PictureShape, [number, number]>> = { wide: [48, 32], tall: [32, 48], square: [40, 40] };
const COLOURS: readonly (readonly [number, number, number])[] = [
  [214, 160, 90],
  [120, 170, 140],
  [200, 110, 120],
  [110, 140, 200],
];

/** The fake's models. */
export const FAKE_PICTURE_MODELS = ['fake-picture-1'];

export function fakePictures(opts: { kind?: PictureMakerKind; calls?: MakeRequest[] } = {}): PictureMaker {
  return {
    kind: opts.kind ?? 'openai-compatible',
    listModels: async () => [...FAKE_PICTURE_MODELS],
    async make(req): Promise<MakeResult> {
      opts.calls?.push(req);
      if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAKE_COUNT_MAX) throw new PictureError('config', 'count out of range');
      const words = req.prompt.toLowerCase();
      if (words.includes('refuse')) throw new PictureError('refused', 'the fake refuses');
      if (words.includes('fail')) throw new PictureError('server', 'the fake fails');
      if (words.includes('busy')) throw new PictureError('rate_limit', 'the fake is busy', { status: 429 });
      if (words.includes('slow')) await new Promise((resolve) => setTimeout(resolve, 1000));
      if (req.signal?.aborted === true) throw new PictureError('aborted', 'stopped');
      const [width, height] = SIZE[req.shape];
      const pictures = Array.from({ length: req.count }, (_, i) => ({ bytes: fakePng(width, height, COLOURS[i % COLOURS.length] as readonly [number, number, number]), type: 'image/png' as const, width, height }));
      return { pictures, dropped: 0, refused: 0 };
    },
  };
}
