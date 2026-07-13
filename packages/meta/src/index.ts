/**
 * @adminium/meta — the adminium_* meta-store (07-meta-store.md).
 *
 * Kysely models for every BRIEF §6 table, prefixed-ULID ids, the up-only
 * migration runner with checksum drift detection, thin typed repos, and the
 * first-run bootstrap. Dialect-portable across PostgreSQL, MySQL/MariaDB, and
 * SQLite; database drivers are injected by the caller (see connect.ts).
 *
 * Imports only kysely + zod (+ node: builtins) — the 01-architecture.md §2.3
 * import matrix bans engine/adapters/server imports here.
 */

export * from './ids.js';
export * from './prefix.js';
export * from './columns.js';
export * from './connect.js';
export * from './schema/index.js';
export * from './migrations/index.js';
export * from './migrator.js';
export * from './repos/index.js';
export * from './bootstrap.js';
