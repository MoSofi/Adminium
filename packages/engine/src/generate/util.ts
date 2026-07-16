/**
 * Shared helpers for the generator (05-introspection-engine.md generation
 * section, 09-generated-app.md §2.2 slug rules).
 *
 * Everything here is pure and deterministic — `generatePages()` promises
 * "same inputs, same output" (05 §9), so no randomness, no Date.now().
 */

import { sha256Hex } from '../snapshot/sha256.js';

/**
 * Meta `id` columns are char(36) (07-meta-store.md §2.1); generated page ids
 * are `page_<slug>` (5 + slug), so slugs cap at 31 characters.
 */
export const MAX_SLUG_LENGTH = 31;

/** `Order_Details` / `orderDetails` → `order-details` (kebab-case, 09 §2.2). */
export function slugify(name: string): string {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, ''); // slugs must start with a letter (kebab pattern)
  return (slug === '' ? 'page' : slug).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
}

/** Deterministic unique-slug allocator: `orders`, `orders-2`, `orders-3`, … */
export class SlugRegistry {
  private readonly taken = new Set<string>();

  claim(base: string): string {
    let candidate = base;
    for (let n = 2; this.taken.has(candidate); n += 1) {
      const suffix = `-${n}`;
      candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    }
    this.taken.add(candidate);
    return candidate;
  }
}

/** `order_details` → `Order Details`; `public.orders` → `Orders`. */
export function humanize(name: string): string {
  const bare = name.includes('.') ? (name.split('.').pop() ?? name) : name;
  return bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Tiny pluralizer for domain/table labels ("Order" → "Orders"). */
export function pluralizeWord(word: string): string {
  if (/s$/i.test(word)) return word; // already plural (or an s-final noun)
  if (/(x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortKeysDeep(record[key]);
    return sorted;
  }
  return value;
}

/**
 * `generated_hash` for a page document (01-architecture.md §6.1 / 04 §6.3):
 * sha256 over the canonical (sorted-keys) JSON of the envelope with the
 * embedded `config.generatedHash` itself excluded. M5 regeneration compares
 * this against the stored document to tell user-edited pages ("user delta
 * wins") from untouched generated ones (updated in place).
 */
/**
 * How many characters of the slug fit into a connection-scoped page id:
 * 'page_' (5) + hash8 (8) + '_' (1) = 14, leaving 22 of the char(36) PK.
 */
export const ID_SLUG_BUDGET = 22;

/**
 * The slug as it appears inside a page id, within {@link ID_SLUG_BUDGET}.
 *
 * Must be INJECTIVE: `SlugRegistry` only de-duplicates against the full
 * {@link MAX_SLUG_LENGTH} slug, so a plain `slice(0, 22)` maps distinct slugs to
 * one id — `order_details_archive_2024` and `..._2025` both became
 * `page_<scope>_order-details-archive-`. `pagesRepo.upsertGenerated` rejects
 * duplicate ids, so that collision failed the WHOLE connection's generation run,
 * not just the colliding pair. Over-budget slugs therefore keep a readable head
 * and earn a digest of the full slug, which distinct slugs cannot share.
 */
function idSlug(slug: string): string {
  if (slug.length <= ID_SLUG_BUDGET) return slug;
  const digest = sha256Hex(slug).slice(0, 8);
  const head = slug.slice(0, ID_SLUG_BUDGET - digest.length - 1).replace(/-+$/, '');
  return `${head}-${digest}`;
}

/**
 * Stable, connection-scoped page id. Ids are GLOBALLY unique in
 * adminium_pages (char(36) PK), while slugs are only unique per connection —
 * so multi-connection installs need the connection folded into the id
 * (regression: second connection's 'page_customers' collided with the
 * first's). Connection-less (universal) pages keep the bare readable form
 * ('page_' + a slug already capped at 31 = 36).
 */
export function pageIdFor(connectionId: string | null, slug: string): string {
  if (connectionId === null) return `page_${slug}`;
  const scope = sha256Hex(connectionId).slice(0, 8);
  return `page_${scope}_${idSlug(slug)}`;
}

export function hashEnvelope(envelope: Record<string, unknown>): string {
  const plain = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
  const config = plain['config'];
  if (config !== null && typeof config === 'object') {
    delete (config as Record<string, unknown>)['generatedHash'];
  }
  return sha256Hex(JSON.stringify(sortKeysDeep(plain)));
}
