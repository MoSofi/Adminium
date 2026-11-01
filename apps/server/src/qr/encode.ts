// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QR code of a short text — a ticket's code, a share token — as the grid of
 * its modules, drawn by the `qr` package (pinned exactly: a change of its
 * output is a change of every printed ticket). It encodes the text alone:
 * no address, no name, no order; the door reads back the code and nothing
 * else. Medium error correction, which survives a crease or a smudge.
 *
 * A page's address (a form's link) is a longer text, held to a limit of its
 * own (`{ page: true }`), so the ticket's limit never grows with it.
 *
 * Email draws it as a PNG (`png.ts`), a page as SVG (`svg.ts`), a document
 * from the grid itself. The same options live in the browser client
 * (`@adminium/public-client/qr`), and both are held to one fixture.
 */
import { encodeQR } from 'qr';

/** The longest text a QR code here carries: a code is at most 16 characters, and a token fits too. */
export const QR_MAX_BYTES = 64;

/**
 * The longest a page's address may be when its QR code is asked for with
 * `{ page: true }`: a form's or a landing page's link on the install's own
 * address. A limit of its own, so a ticket's code stays held to 64 bytes.
 */
export const QR_PAGE_MAX_BYTES = 256;

/** Modules of white around a code: the quiet zone scanners need. */
export const QR_QUIET = 4;

/** What a code is of: a short code (the default), or a page's address. */
export interface QrOptions {
  page?: boolean | undefined;
}

/** The most bytes a code of this kind carries. */
export const qrMaxBytes = (opts: QrOptions = {}): number => (opts.page === true ? QR_PAGE_MAX_BYTES : QR_MAX_BYTES);

/** A text a QR code cannot carry here: empty, or longer than its kind's limit. */
export class QrTextRefused extends Error {
  override readonly name = 'QrTextRefused';
}

/** Whether a text is one a QR code here carries. */
export function qrCarries(text: unknown, opts: QrOptions = {}): text is string {
  return typeof text === 'string' && text !== '' && new TextEncoder().encode(text).length <= qrMaxBytes(opts);
}

/**
 * The modules of the QR code of `text`, row by row, `true` for a dark one,
 * with no quiet zone around them. The same text gives the same grid every
 * time.
 */
export function qrMatrix(text: string, opts: QrOptions = {}): boolean[][] {
  if (!qrCarries(text, opts)) throw new QrTextRefused(`A QR code carries 1 to ${String(qrMaxBytes(opts))} bytes of text.`);
  // The package draws a quiet zone of at least one module: the ring is cut off here.
  const framed = encodeQR(text, 'raw', { ecc: 'medium', border: 1 });
  return framed.slice(1, -1).map((row) => row.slice(1, -1));
}

/** The grid as text rows of `0` and `1` (a document's value, and the fixtures). */
export function qrRows(text: string, opts: QrOptions = {}): string[] {
  return qrMatrix(text, opts).map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
}
