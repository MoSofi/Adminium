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
export function hashEnvelope(envelope: Record<string, unknown>): string {
  const plain = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
  const config = plain['config'];
  if (config !== null && typeof config === 'object') {
    delete (config as Record<string, unknown>)['generatedHash'];
  }
  return sha256Hex(JSON.stringify(sortKeysDeep(plain)));
}
