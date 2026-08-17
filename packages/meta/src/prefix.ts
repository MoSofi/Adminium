// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Table-name prefix guard (07-meta-store.md §1, §4 "prefix safety").
 * All DDL and the migration runner go through {@link metaTable}, which asserts
 * the final physical name carries the `adminium_` prefix — the runner refuses
 * to touch any other table.
 */

export const META_PREFIX = 'adminium_';

export class MetaPrefixError extends Error {
  override name = 'MetaPrefixError';
}

/**
 * `metaTable('users')` → `'adminium_users'`.
 * Rejects names that already carry the prefix (double-prefix bug) and names
 * that would not resolve inside the adminium_ namespace.
 */
export function metaTable(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new MetaPrefixError(`invalid meta table name: ${JSON.stringify(name)}`);
  }
  if (name.startsWith(META_PREFIX)) {
    throw new MetaPrefixError(`table name already prefixed: ${name}`);
  }
  const full = `${META_PREFIX}${name}`;
  assertMetaTable(full);
  return full;
}

/** Assert an already-qualified physical name lives in the adminium_ namespace. */
export function assertMetaTable(name: string): void {
  if (!name.startsWith(META_PREFIX)) {
    throw new MetaPrefixError(`refusing to touch non-adminium table: ${name}`);
  }
}
