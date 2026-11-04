// SPDX-License-Identifier: AGPL-3.0-only
/** A small PDF a stranger sends with a form: enough bytes to be one. */
export const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
