// SPDX-License-Identifier: AGPL-3.0-only
/** QR codes of short texts: the grid, a PNG for email and documents, SVG for pages. */
export { QR_MAX_BYTES, QR_PAGE_MAX_BYTES, QR_QUIET, QrTextRefused, qrCarries, qrMatrix, qrMaxBytes, qrRows, type QrOptions } from './encode.js';
export { QR_PNG_SCALE, qrPng, qrPngDataUrl, qrPngSize } from './png.js';
export { qrSvg } from './svg.js';
