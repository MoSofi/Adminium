// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document may carry a QR code: an outline slot of type `qr`, whose value
 * the host makes (the text, its modules, a PNG) so a provider draws it with
 * no encoder of its own. Added beside the other slot types; every outline
 * that parsed before still parses.
 */
import { describe, expect, it } from 'vitest';

import { DOCUMENT_LOCALE_IDS, OUTLINE_SLOT_TYPES, documentOutlineSchema, documentQrValueSchema, outlineSlotSchema } from '../src/index.js';

const label = (text: string) => Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, text]));
const square = (size: number) => Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => ((row + col) % 2 === 0 ? '1' : '0')).join(''));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==';

describe('a qr slot', () => {
  it('is one of the slot types, after every one there was', () => {
    expect(OUTLINE_SLOT_TYPES.slice(0, -1)).toEqual(['text', 'text[]', 'date', 'email', 'money', 'percent', 'currency', 'number', 'collection']);
    expect(OUTLINE_SLOT_TYPES.at(-1)).toBe('qr');
  });

  it('parses in an outline, beside the older types, and as a collection column', () => {
    const outline = {
      slots: [
        { id: 'holder', label: label('Holder'), type: 'text', required: true },
        { id: 'code', label: label('Code'), type: 'qr', required: true },
        { id: 'tickets', label: label('Tickets'), type: 'collection', required: false, columns: [{ id: 'code', label: label('Code'), type: 'qr', required: false }] },
      ],
    };
    expect(documentOutlineSchema.safeParse(outline).success).toBe(true);
    expect(outlineSlotSchema.safeParse({ id: 'code', label: label('Code'), type: 'barcode', required: true }).success).toBe(false);
  });

  it('carries the text, square rows of modules and a PNG', () => {
    expect(documentQrValueSchema.safeParse({ text: 'K7QX-M2PD', modules: square(21), png }).success).toBe(true);
    expect(documentQrValueSchema.safeParse({ text: 'K7QX-M2PD', modules: [...square(21).slice(0, 20), '1'], png }).success).toBe(false);
    expect(documentQrValueSchema.safeParse({ text: 'K7QX-M2PD', modules: square(21).map((row) => row.replace('1', '2')), png }).success).toBe(false);
    expect(documentQrValueSchema.safeParse({ text: 'K7QX-M2PD', modules: square(20), png }).success).toBe(false);
    expect(documentQrValueSchema.safeParse({ text: 'K7QX-M2PD', modules: square(21), png: 'data:image/svg+xml;base64,AAAA' }).success).toBe(false);
    expect(documentQrValueSchema.safeParse({ text: '', modules: square(21), png }).success).toBe(false);
    expect(documentQrValueSchema.safeParse({ text: 'x'.repeat(65), modules: square(21), png }).success).toBe(false);
  });
});
