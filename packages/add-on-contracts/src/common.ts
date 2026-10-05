// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shapes shared by more than one contract. Kept in one place so a `FileRef`
 * from a carrier label and a `FileRef` from a production file are the same
 * type — the host stores both through one file seam.
 */

import { z } from 'zod';

export interface FileRef {
  fileId: string;
  filename: string;
  mediaType: string;
  bytes: number;
}

export const fileRefSchema = z
  .object({
    fileId: z.string().min(1),
    filename: z.string().min(1),
    mediaType: z.string().min(1),
    bytes: z.number().int().positive(),
  })
  .strict();

/** An i18n message: a catalog key plus the English fallback rendered when the key is absent. */
export const i18nMessageSchema = z
  .object({
    key: z.string().min(1).max(120),
    fallback: z.string().min(1).max(400),
  })
  .strict();
export type I18nMessage = z.infer<typeof i18nMessageSchema>;
