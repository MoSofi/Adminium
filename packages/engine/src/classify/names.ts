/**
 * Name normalization for classifier rules — 05-introspection-engine.md §7:
 * "Name matching operates on a normalized token form: lowercase, camelCase
 * split to snake_case." Every regex in columns.ts/pii.ts/tables.ts runs
 * against `normalizeName(name)`, never the raw identifier.
 */

/** `userId` → `user_id`, `HTMLBody` → `html_body`, `Created-At` → `created_at`. */
export function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/** Split a normalized name into tokens (`unit_price` → ['unit','price']). */
export function nameTokens(name: string): string[] {
  return normalizeName(name).split('_').filter(Boolean);
}
