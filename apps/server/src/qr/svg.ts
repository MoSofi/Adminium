// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QR code as SVG for a page (staff print): one path of the dark modules
 * on a white square, crisp at any size, a few hundred bytes.
 */
import { QR_QUIET, qrMatrix } from './encode.js';

/** The QR code of `text` as an SVG document, `size` pixels across (the view box is in modules). */
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
  const size = opts.size === undefined ? '' : ` width="${String(opts.size)}" height="${String(opts.size)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(width)}"${size} shape-rendering="crispEdges"><rect width="${String(width)}" height="${String(width)}" fill="#fff"/><path fill="#000" d="${path.join('')}"/></svg>`;
}
