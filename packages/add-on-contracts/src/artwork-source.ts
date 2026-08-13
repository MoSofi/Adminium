/**
 * `artwork-source@1` (24 §5.5) — a way for a customer to supply artwork that is
 * not a plain upload.
 *
 * The asymmetry that makes this contract worth having: the HOST, not the
 * add-on, runs the artwork checks on the returned `ArtworkRef`. Design Studio's
 * output passes by construction because it was built at the finished size with
 * the bleed already on it; a design brought in from somewhere else routinely
 * does not. Neither implementation marks its own homework.
 */

import { z } from 'zod';

/** The job the customer is supplying artwork for. */
export interface JobSpec {
  /** Product family key, e.g. `business-cards`. */
  productKey: string;
  /** Human label for the product, already localized by the host. */
  productLabel: string;
  /** Finished (trim) size in millimetres. */
  trimWidthMm: number;
  trimHeightMm: number;
  /** Bleed the works needs on every edge, in millimetres. */
  bleedMm: number;
  sides: 1 | 2;
  quantity: number;
}

/** What an artwork source hands back to the host. */
export interface ArtworkRef {
  fileId: string;
  /** The add-on key that produced it. */
  source: string;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  dpi: number;
  pages: number;
  previewFileId?: string;
}

export interface ArtworkSource {
  readonly key: string;
  /** e.g. "Design it here" / "Bring it from Canva" — the host renders it. */
  label(job: JobSpec): string;
  available(job: JobSpec): AvailabilityVerdict;
  /** Resolves to the artwork, or null when the customer backed out. */
  start(job: JobSpec): Promise<ArtworkRef | null>;
}

export type AvailabilityVerdict = { ok: true } | { ok: false; reason: string };

export const jobSpecSchema = z
  .object({
    productKey: z.string().min(1),
    productLabel: z.string().min(1),
    trimWidthMm: z.number().positive(),
    trimHeightMm: z.number().positive(),
    bleedMm: z.number().min(0),
    sides: z.union([z.literal(1), z.literal(2)]),
    quantity: z.number().int().positive(),
  })
  .strict();

export const artworkRefSchema = z
  .object({
    fileId: z.string().min(1),
    source: z.string().min(1),
    widthMm: z.number().positive(),
    heightMm: z.number().positive(),
    bleedMm: z.number().min(0),
    dpi: z.number().positive(),
    pages: z.number().int().positive(),
    previewFileId: z.string().min(1).optional(),
  })
  .strict();
