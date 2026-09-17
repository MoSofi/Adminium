// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading an uploaded image into the document (the comp's `readImg`,
 * 1324-1328): a `FileReader` data URL, capped so a single letterhead
 * never makes a body nobody sized for. The caller shows the reason on
 * refusal.
 */
import { IMAGE_DATA_URL_MAX } from '../model/envelope.js';

export type ImageReadResult = { ok: true; dataUrl: string } | { ok: false; reason: 'notImage' | 'tooLarge' | 'unreadable' };

/** The cap in a form a message can print: "384 KB". */
export const IMAGE_MAX_LABEL = `${String(Math.round((IMAGE_DATA_URL_MAX * 3) / 4 / 1024))} KB`;

export function readImageFile(file: File): Promise<ImageReadResult> {
  if (!file.type.startsWith('image/')) return Promise.resolve({ ok: false, reason: 'notImage' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, reason: 'unreadable' });
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl === '') {
        resolve({ ok: false, reason: 'unreadable' });
        return;
      }
      if (dataUrl.length > IMAGE_DATA_URL_MAX) {
        resolve({ ok: false, reason: 'tooLarge' });
        return;
      }
      resolve({ ok: true, dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

/** The first image of a file input's change event, if any; clears the input so the same file can be picked again (comp 1327). */
export function fileFromInput(event: { target: HTMLInputElement }): File | null {
  const file = event.target.files?.[0] ?? null;
  try {
    event.target.value = '';
  } catch {
    // Some engines refuse to reset a file input; the next pick still works.
  }
  return file;
}
