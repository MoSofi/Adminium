// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A lead source add-on's keys, one per source, inside the add-on's one
 * encrypted credential envelope.
 *
 * An add-on that finds companies talks to several services (a register, a
 * paid directory, an address finder), each with a key of its own or none.
 * The owner saves, replaces and removes each on its own, and a call to one
 * service is handed that service's key only. So the envelope's secret for
 * such an add-on is a small versioned document, in the shape payments keep
 * their test and live sets in:
 *
 *     { sources: 1, "companies-house": { key: "…" }, "hunter": { key: "…" } }
 *
 * It is read here, parsed (never cast). A key is written with
 * `withSourceKey`; the routes that call it are the add-on's Sources routes,
 * never the generic connect route, which refuses such an add-on.
 */
import type { CredentialEnvelope } from '@adminium/meta';
import { z } from 'zod';

import { withoutQueries } from '../add-ons/egress.js';

export { lastFour } from '../payments/credentials.js';

/** A source's id, as the manifest word allows it. */
export const SOURCE_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
/** The longest key kept. */
export const SOURCE_KEY_MAX = 4096;
/** The document's own version mark: never a source's id. */
const VERSION_FIELD = 'sources';

const sourceKeySchema = z.object({ key: z.string().min(1).max(SOURCE_KEY_MAX) }).strict();

/** Each source's id must be a source id; the version mark is the one other field. */
export const sourceSecretSchema = z
  .object({ sources: z.literal(1) })
  .catchall(sourceKeySchema)
  .superRefine((value, context) => {
    for (const id of Object.keys(value)) {
      if (id !== VERSION_FIELD && !SOURCE_ID_RE.test(id)) context.addIssue({ code: 'custom', message: `"${id}" is not a source id.`, path: [id] });
    }
  });

/** The keys, by source id. */
export type SourceSecret = z.infer<typeof sourceSecretSchema>;

/** Each saved key, by source id, read off the envelope; empty when it holds none (or is not a sources envelope). */
function keysOf(envelope: CredentialEnvelope | null): Map<string, string> {
  const out = new Map<string, string>();
  if (envelope === null) return out;
  const parsed = sourceSecretSchema.safeParse(envelope.secret);
  if (!parsed.success) return out;
  for (const [id, entry] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (id === VERSION_FIELD) continue;
    const one = sourceKeySchema.safeParse(entry);
    if (one.success) out.set(id, one.data.key);
  }
  return out;
}

/**
 * A source's or the engine's words with the key taken out: as it was saved,
 * and as it reads inside a URL (some services take their key in the query
 * string), and every query string with it.
 */
export function withoutKey(text: string, key: string | null): string {
  return withoutQueries(withoutKeyText(text, key));
}

/** Text without the key, as written and as it reads inside a URL; every other part, a query string included, as it was. */
export function withoutKeyText(text: string, key: string | null): string {
  let out = text;
  if (key !== null && key.length >= 4) {
    for (const form of new Set([key, encodeURIComponent(key), encodeURI(key), encodeURIComponent(key).replace(/%20/g, '+')])) out = out.split(form).join('[the saved key]');
  }
  return out;
}

/** One source's key, or null when none is saved. */
export function sourceKey(envelope: CredentialEnvelope | null, id: string): string | null {
  if (id === VERSION_FIELD) return null;
  return keysOf(envelope).get(id) ?? null;
}

/**
 * The envelope's secret with one source's key set (or removed, with
 * `value: null` or an empty paste). Spaces around a pasted key are trimmed;
 * every other source's key is kept as it was.
 */
export function withSourceKey(current: CredentialEnvelope | null, id: string, value: string | null): SourceSecret {
  if (id === VERSION_FIELD || !SOURCE_ID_RE.test(id)) throw new Error(`"${id}" is not a source id.`);
  const keys = keysOf(current);
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') keys.delete(id);
  else keys.set(id, trimmed);
  const next: Record<string, unknown> = { sources: 1 };
  for (const [one, key] of [...keys].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) next[one] = { key };
  // Parsed on the way out too: a key too long for the store is refused here, not after it was written.
  return sourceSecretSchema.parse(next);
}
