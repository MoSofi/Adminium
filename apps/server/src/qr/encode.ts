// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QR code of a short text — a ticket's code, a share token — as the grid of
 * its modules, drawn by the `qr` package (pinned exactly: a change of its
 * output is a change of every printed ticket). It encodes the text alone:
 * no address, no name, no order; the door reads back the code and nothing
 * else. Medium error correction, which survives a crease or a smudge.
 *
 * Email draws it as a PNG (`png.ts`), a page as SVG (`svg.ts`), a document
 * from the grid itself. The same options live in the browser client
 * (`@adminium/public-client/qr`), and both are held to one fixture.
 */
import { encodeQR } from 'qr';

/** The longest text a QR code here carries: a code is at most 16 characters, and a token fits too. */
export const QR_MAX_BYTES = 64;

/** Modules of white around a code: the quiet zone scanners need. */
export const QR_QUIET = 4;

/** A text a QR code cannot carry here: empty, or longer than {@link QR_MAX_BYTES} bytes. */
export class QrTextRefused extends Error {
  override readonly name = 'QrTextRefused';
}

/** Whether a text is one a QR code here carries. */
export function qrCarries(text: unknown): text is string {
  return typeof text === 'string' && text !== '' && new TextEncoder().encode(text).length <= QR_MAX_BYTES;
}

/**
 * The modules of the QR code of `text`, row by row, `true` for a dark one,
 * with no quiet zone around them. The same text gives the same grid every
 * time.
 */
export function qrMatrix(text: string): boolean[][] {
  if (!qrCarries(text)) throw new QrTextRefused(`A QR code carries 1 to ${String(QR_MAX_BYTES)} bytes of text.`);
  // The package draws a quiet zone of at least one module: the ring is cut off here.
  const framed = encodeQR(text, 'raw', { ecc: 'medium', border: 1 });
  return framed.slice(1, -1).map((row) => row.slice(1, -1));
}

/** The grid as text rows of `0` and `1` (a document's value, and the fixtures). */
export function qrRows(text: string): string[] {
  return qrMatrix(text).map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
}
