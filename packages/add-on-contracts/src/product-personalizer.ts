/**
 * `product-personalizer@1` (24 §5.5, added 2026-08-05 with `personalizer`) —
 * the one contract whose implementation spans three surfaces (shopper, staff,
 * dashboard), which is why it is a contract at all rather than a screen.
 *
 * Landed here with wave 4a even though its implementation ships in 4b: the
 * registry is frozen once, before anything ships, rather than widened after a
 * release (§1.1's sequencing note).
 */

import { z } from 'zod';

import type { FileRef } from './common.js';

export type ZoneKind = 'text-line' | 'text-block' | 'image' | 'colour';
export type ZoneFinish = 'engraved' | 'raised' | 'printed' | 'painted';

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  shape: {
    type: 'rect' | 'ellipse';
    xMm: number;
    yMm: number;
    wMm: number;
    hMm: number;
  };
  constraints: {
    maxChars?: number;
    fonts?: string[];
    minSizeMm?: number;
    maxSizeMm?: number;
    palette?: string[];
  };
  finish: ZoneFinish;
  /** Where the zone lands on each supplied angle; absent ⇒ not visible there. */
  perAngle: Record<
    string,
    { xPct: number; yPct: number; wPct: number; hPct: number; skewDeg?: number }
  >;
}

export interface Template {
  productKey: string;
  angles: { id: string; label: string; fileId: string }[];
  zones: Zone[];
}

export interface Personalization {
  templateId: string;
  values: Record<string, string>;
  font?: string;
  sizeMm?: number;
  finish?: ZoneFinish;
}

export interface ProductRef {
  productKey: string;
  variant?: string;
  quantity: number;
}

export interface PreviewRef {
  fileId: string;
  angle: string;
  widthPx: number;
  /** Content hash — equal values + equal angle ⇒ equal digest (determinism). */
  digest: string;
}

/**
 * An overrun carries BOTH remedies with their numbers — the UI renders them as
 * buttons. A bare "doesn't fit" is a contract violation, not a UI choice.
 */
export type Verdict =
  | { zone: string; ok: true }
  | {
      zone: string;
      ok: false;
      reason: string;
      remedies: { setSizeMm?: number; shortenToChars?: number };
    };

export interface ProductPersonalizer {
  readonly key: string;
  available(product: ProductRef): { ok: true } | { ok: false; reason: string };
  /** The shopper's surface. Resolves to their choices, or null if they backed out. */
  open(product: ProductRef, initial?: Personalization): Promise<Personalization | null>;
  /** Deterministic: same values + same angle ⇒ same image. */
  render(p: Personalization, opts: { angle: string; widthPx: number }): Promise<PreviewRef>;
  /** What goes to the machine — outlines, layered. Never drives hardware. */
  productionFile(p: Personalization): Promise<FileRef>;
  validate(p: Personalization, t: Template): Verdict[];
}

export const zoneSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['text-line', 'text-block', 'image', 'colour']),
    shape: z
      .object({
        type: z.enum(['rect', 'ellipse']),
        xMm: z.number(),
        yMm: z.number(),
        wMm: z.number().positive(),
        hMm: z.number().positive(),
      })
      .strict(),
    constraints: z
      .object({
        maxChars: z.number().int().positive().optional(),
        fonts: z.array(z.string().min(1)).optional(),
        minSizeMm: z.number().positive().optional(),
        maxSizeMm: z.number().positive().optional(),
        palette: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    finish: z.enum(['engraved', 'raised', 'printed', 'painted']),
    perAngle: z.record(
      z.string(),
      z
        .object({
          xPct: z.number(),
          yPct: z.number(),
          wPct: z.number(),
          hPct: z.number(),
          skewDeg: z.number().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const templateSchema = z
  .object({
    productKey: z.string().min(1),
    angles: z
      .array(
        z.object({ id: z.string().min(1), label: z.string().min(1), fileId: z.string().min(1) }).strict(),
      )
      .min(1),
    zones: z.array(zoneSchema),
  })
  .strict();

export const personalizationSchema = z
  .object({
    templateId: z.string().min(1),
    values: z.record(z.string(), z.string()),
    font: z.string().min(1).optional(),
    sizeMm: z.number().positive().optional(),
    finish: z.enum(['engraved', 'raised', 'printed', 'painted']).optional(),
  })
  .strict();
