// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/public-client/qr` — a ticket's QR code drawn in the browser, the
 * same one Adminium puts in the ticket's email: the same encoder, pinned to
 * the same version, with the same options (medium error correction, a quiet
 * zone of four modules), so the door reads the same code either way. It
 * needs no network: a door or a phone offline still draws the code it
 * already holds. A subpath of its own, so a page that shows no code carries
 * no encoder.
 *
 * ```ts
 * import { qrSvg } from '@adminium/public-client/qr';
 * ticketEl.innerHTML = qrSvg(ticket.code, { size: 180 });
 * ```
 */
import { encodeQR } from 'qr';

/** The longest text a code carries: a ticket code or a share token, never a page's address. */
export const QR_MAX_BYTES = 64;

/** Modules of white around the code. */
export const QR_QUIET = 4;

/**
 * The modules of the QR code of `text`, row by row, `true` for a dark one,
 * with no quiet zone. Throws for an empty text or one longer than
 * {@link QR_MAX_BYTES} bytes.
 */
export function qrMatrix(text: string): boolean[][] {
  if (typeof text !== 'string' || text === '' || new TextEncoder().encode(text).length > QR_MAX_BYTES) {
    throw new RangeError(`A QR code carries 1 to ${String(QR_MAX_BYTES)} bytes of text.`);
  }
  const framed = encodeQR(text, 'raw', { ecc: 'medium', border: 1 });
  return framed.slice(1, -1).map((row) => row.slice(1, -1));
}

/**
 * The QR code of `text` as an SVG document on a white square (never
 * transparent: a dark page would swallow the quiet zone), `size` pixels
 * across when given. Safe to put in the page: it holds no text of the code.
 */
export function qrSvg(text: string, opts: { size?: number } = {}): string {
  const modules = qrMatrix(text);
  const width = modules.length + 2 * QR_QUIET;
  const path: string[] = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === true) run += 1;
      path.push(`M${String(x + QR_QUIET)} ${String(y + QR_QUIET)}h${String(run)}v1h-${String(run)}z`);
      x += run;
    }
  });
  const size = opts.size === undefined ? '' : ` width="${String(Math.round(opts.size))}" height="${String(Math.round(opts.size))}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(width)}"${size} shape-rendering="crispEdges"><rect width="${String(width)}" height="${String(width)}" fill="#fff"/><path fill="#000" d="${path.join('')}"/></svg>`;
}
