// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document may carry a picture: an outline slot of type `picture`, whose
 * value the host makes from a file a column of the document's own row holds
 * (a customer's drawn signature), so a provider never reads the file store.
 * Added after every slot type there was; every outline that parsed before
 * still parses. A picture is never a column of a list.
 */
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_LOCALE_IDS,
  DOCUMENT_PICTURE_MEDIA_TYPES,
  OUTLINE_SLOT_TYPES,
  documentOutlineSchema,
  documentPictureValueSchema,
  outlineSlotSchema,
} from '../src/index.js';
import { SAMPLE_DOCUMENT_PICTURE } from '../src/testing/index.js';

const label = (text: string) => Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, text]));
const png = SAMPLE_DOCUMENT_PICTURE.dataUrl;

describe('a picture slot', () => {
  it('is the last of the slot types, after every one there was', () => {
    expect(OUTLINE_SLOT_TYPES.at(-1)).toBe('picture');
    expect(OUTLINE_SLOT_TYPES.slice(0, -1)).toEqual(['text', 'text[]', 'date', 'email', 'money', 'percent', 'currency', 'number', 'collection', 'qr']);
    expect(DOCUMENT_PICTURE_MEDIA_TYPES).toEqual(['image/png', 'image/jpeg']);
  });

  it('parses in an outline beside the older types, and never as a collection column', () => {
    const outline = {
      slots: [
        { id: 'signer', label: label('Signed by'), type: 'text', required: true },
        { id: 'signature', label: label('Signature'), type: 'picture', required: false },
      ],
    };
    expect(documentOutlineSchema.safeParse(outline).success).toBe(true);
    const listed = { id: 'snags', label: label('Snags'), type: 'collection', required: false, columns: [{ id: 'photo', label: label('Photo'), type: 'picture', required: false }] };
    const refused = outlineSlotSchema.safeParse(listed);
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('never a picture');
  });

  it('carries a PNG or a JPEG as a data URL of its own kind, and its size in pixels', () => {
    expect(documentPictureValueSchema.safeParse(SAMPLE_DOCUMENT_PICTURE).success).toBe(true);
    const jpeg = { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', width: 640, height: 200 };
    expect(documentPictureValueSchema.safeParse(jpeg).success).toBe(true);
    for (const wrong of [
      { ...SAMPLE_DOCUMENT_PICTURE, mediaType: 'image/webp' },
      { ...SAMPLE_DOCUMENT_PICTURE, mediaType: 'image/jpeg' },
      { ...SAMPLE_DOCUMENT_PICTURE, dataUrl: 'data:image/svg+xml;base64,AAAA' },
      { ...SAMPLE_DOCUMENT_PICTURE, dataUrl: 'https://example.com/signature.png' },
      { ...SAMPLE_DOCUMENT_PICTURE, width: 0 },
      { ...SAMPLE_DOCUMENT_PICTURE, height: 8193 },
      { ...SAMPLE_DOCUMENT_PICTURE, width: 1.5 },
      { ...SAMPLE_DOCUMENT_PICTURE, fileId: 'file_1' },
      { mediaType: 'image/png', dataUrl: png },
    ]) {
      expect(documentPictureValueSchema.safeParse(wrong).success, JSON.stringify(wrong)).toBe(false);
    }
  });
});
