// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketplace API's wire format, `adminium-marketplace/1` — what
 * `https://adminium.dev/api/v1/marketplace/apps` and `/add-ons` answer, as an
 * Adminium server reads it.
 *
 * ── TWO POSTURES IN ONE DOCUMENT ────────────────────────────────────────────
 *
 * THE ITEM IS LENIENT. Names, art, links and dates are display facts, and a
 * field this server does not know is dropped (zod's default strip). That is
 * what lets the site grow a display field without breaking every server
 * already in service — the reason the static feeds before this had to move to
 * a new address each time they changed (v1, v2, v3).
 *
 * THE RELEASE IS STRICT. `release` is the install contract: the exact version,
 * the fingerprint the downloaded bytes are checked against, the floor, and
 * what the verified file's manifest says. A field here that this server does
 * not know is a refusal of that ITEM, never a warning — which is how "no price
 * reaches an install" holds by construction rather than by nobody sending one.
 * A pricing block at ITEM level is simply stripped: pricing is not shown in
 * this round, and no DTO carries it.
 *
 * ONE ITEM, ONE VERDICT. Items are parsed one at a time: an item whose release
 * this server cannot read is skipped and counted, and the rest of the shelf is
 * still offered. Only a document that is not this format at all is refused.
 *
 * `?adminium=<version>`: the site offers each item's newest release this
 * version can install, and names the newest one in `newerRelease` when that
 * is a different one. An item whose every release is too new comes back with
 * `release: null` and a `newerRelease`.
 */
import { z } from 'zod';

export const MARKETPLACE_FORMAT = 'adminium-marketplace/1';

/** An item key: the grammar the stores, the payloads and the download paths share. */
export const MARKETPLACE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
/** An exact version — never a range, never `latest`. One optional tail group (see the add-on catalog client). */
export const MARKETPLACE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]+)?$/;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

const localized = z.record(z.string(), z.string());
const version = z.string().regex(MARKETPLACE_VERSION_PATTERN);

/** An add-on release's install facts, strict. */
export const addOnReleaseWireSchema = z
  .object({
    version,
    integrity: z.string().regex(INTEGRITY_PATTERN),
    categories: z.array(z.string()),
    capabilities: z.array(z.string()),
    connect: z.object({ kind: z.enum(['none', 'api-key', 'oauth2']) }).strict(),
    provides: z.array(z.object({ contract: z.string(), version: z.number().int().positive() }).strict()),
    attaches: z.array(z.object({ app: z.string(), range: z.string().optional() }).strict()),
    network: z.object({ allow: z.array(z.string()) }).strict(),
    minAdminiumVersion: version,
    publisher: z.string().min(1).optional(),
  })
  .strict();

/** A need as the manifest declares it; read for display, the staged manifest decides the install. */
const needWire = z.object({ key: z.string().regex(MARKETPLACE_KEY_PATTERN) }).passthrough();

/** An app release's install facts, strict. */
export const appReleaseWireSchema = z
  .object({
    version,
    integrity: z.string().regex(INTEGRITY_PATTERN),
    categories: z.array(z.string()),
    capabilities: z.array(z.string()),
    publisher: z.string().min(1),
    sides: z.array(z.enum(['staff', 'customer'])).min(1),
    minAdminiumVersion: version,
    /** Which add-ons the app needs or can use (the "Needs Invoices" line). */
    addOns: z
      .object({
        requires: z.array(needWire),
        suggests: z.array(needWire),
        features: z.array(z.object({ requires: z.array(z.string()) }).passthrough()),
      })
      .strict(),
  })
  .strict();

const itemBase = {
  key: z.string().regex(MARKETPLACE_KEY_PATTERN),
  /** `installable` offers a release; `coming-soon` is listed and cannot be downloaded; `source-only` has none to offer. */
  availability: z.enum(['installable', 'coming-soon', 'source-only']),
  name: localized.refine((map) => typeof map['en'] === 'string' && map['en'] !== '', 'an English name'),
  tagline: localized,
  author: z.object({ name: z.string(), url: z.string().optional() }),
  capabilities: z.array(z.string()).default([]),
  art: z
    .object({
      tint: z.string().optional(),
      iconPaths: z.array(z.string()).optional(),
      monogram: z.string().optional(),
    })
    .default({}),
  links: z.object({ page: z.string() }),
  lastUpdatedAt: z.string(),
  file: z.object({ size: z.number().int().nonnegative(), publishedAt: z.string().nullable() }).nullable().default(null),
  newerRelease: z.object({ version, minAdminiumVersion: version }).optional(),
};

export const addOnItemWireSchema = z.object({
  ...itemBase,
  kind: z.literal('add-on'),
  categoryKey: z.string().nullable().default(null),
  release: addOnReleaseWireSchema.nullable(),
});

export const appItemWireSchema = z.object({
  ...itemBase,
  kind: z.literal('app'),
  release: appReleaseWireSchema.nullable(),
});

/** The shelf document around the items: the items themselves are parsed one by one. */
export const marketplaceShelfSchema = z.object({
  format: z.literal(MARKETPLACE_FORMAT),
  generatedAt: z.string().min(1),
  items: z.array(z.unknown()),
});

export type AddOnReleaseWire = z.infer<typeof addOnReleaseWireSchema>;
export type AppReleaseWire = z.infer<typeof appReleaseWireSchema>;
export type AddOnItemWire = z.infer<typeof addOnItemWireSchema>;
export type AppItemWire = z.infer<typeof appItemWireSchema>;

export interface ParsedShelf<T> {
  generatedAt: string;
  items: T[];
  /** Items skipped because this server could not read them, with why. */
  skipped: { key: string | null; reason: string }[];
}

/**
 * One shelf, item by item. Null when the document is not this format at all.
 *
 * An `installable` item must carry a release, and the release must be one
 * this reader can read; anything else is skipped with its reason.
 */
export function parseShelf<S extends typeof addOnItemWireSchema | typeof appItemWireSchema>(
  schema: S,
  document: unknown,
): ParsedShelf<z.infer<S>> | null {
  const shelf = marketplaceShelfSchema.safeParse(document);
  if (!shelf.success) return null;
  const items: z.infer<S>[] = [];
  const skipped: { key: string | null; reason: string }[] = [];
  for (const raw of shelf.data.items) {
    const key = typeof raw === 'object' && raw !== null && typeof (raw as { key?: unknown }).key === 'string' ? (raw as { key: string }).key : null;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      skipped.push({ key, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      continue;
    }
    items.push(parsed.data as z.infer<S>);
  }
  return { generatedAt: shelf.data.generatedAt, items, skipped };
}
