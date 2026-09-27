// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An independent reader for the QR codes Adminium draws: PNG bytes read by
 * `pngjs` and decoded by `jsqr` — another codebase than the encoder's, so a
 * code that reads back here is one a phone at the door reads back.
 */
import jsQRModule from 'jsqr';
import { PNG } from 'pngjs';

// A CommonJS module whose default export Node hands over as the module itself.
type Decode = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'dontInvert' }) => { data: string } | null;
const jsQR: Decode = ((jsQRModule as unknown as { default?: Decode }).default ?? jsQRModule) as unknown as Decode;

/** The text a PNG's QR code carries, or null when none reads. */
export function readQrPng(bytes: Buffer): string | null {
  const image = PNG.sync.read(bytes);
  const rgba = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return jsQR(rgba, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}
